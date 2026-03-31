/**
 * main.js — Apify Actor Entry Point
 * ─────────────────────────────────────────────────────────────
 * Judge.me Reviews Scraper for Shopify Stores
 *
 * Full pipeline (runs automatically):
 *   1. Read input URLs
 *   2. Clean URLs → fetch productId + myshopifyDomain
 *   3. Crawl Judge.me widget API page by page
 *   4. Parse reviews from JSON envelope HTML
 *   5. Save all reviews → dataset + reviews.json
 *   6. Run Groq AI sentiment analysis (if GROQ_API_KEY is set)
 *   7. Save sentiment_report.json + Key-Value store
 */

import { Actor, log }           from 'apify';
import { CheerioCrawler, RequestQueue } from 'crawlee';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname }     from 'path';
import { fileURLToPath }        from 'url';
import { resolveProductInfo, buildJudgeMeUrl } from './url_utils.js';
import { parseReviews, parsePaginationInfo, parseAverageRating } from './review_parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── INIT ─────────────────────────────────────────────────────────────────────
await Actor.init();

// ─── READ INPUT ───────────────────────────────────────────────────────────────
// Tries Apify first, falls back to reading INPUT.json from disk (local dev)
let input = await Actor.getInput();

if (!input?.productUrls?.length) {
    const candidates = [
        resolve(__dirname, '../storage/key_value_stores/default/INPUT.json'),
        resolve(process.cwd(),  'storage/key_value_stores/default/INPUT.json'),
        resolve(process.cwd(),  'INPUT.json'),
    ];
    for (const p of candidates) {
        if (existsSync(p)) {
            log.info(`Reading input from disk: ${p}`);
            input = JSON.parse(readFileSync(p, 'utf-8'));
            break;
        }
    }
}

if (!input) input = {};

const {
    productUrls          = [],
    maxReviewsPerProduct = 0,
    maxConcurrency       = 3,
    enableSentiment      = true,
    proxyConfiguration,
} = input;

if (!productUrls.length) {
    log.error('No productUrls in input. Add at least one URL to INPUT.json');
    await Actor.exit();
    process.exit(0);
}

log.info(`Input received: ${productUrls.length} URL(s)`);
log.info(`Settings: maxReviews=${maxReviewsPerProduct || 'unlimited'} | concurrency=${maxConcurrency} | sentiment=${enableSentiment}`);

// ─── PROXY ────────────────────────────────────────────────────────────────────
let proxyConfig;
if (proxyConfiguration) {
    proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
}

// ─── RESOLVE PRODUCT INFO ─────────────────────────────────────────────────────
log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
log.info('STEP 1: Resolving product info...');

const requestQueue = await RequestQueue.open();

for (const rawUrl of productUrls) {
    try {
        log.info(`  Resolving: ${rawUrl}`);
        const meta = await resolveProductInfo(rawUrl);
        log.info(`  ✓ domain=${meta.storeDomain} | myshopify=${meta.myshopifyDomain} | id=${meta.productId}`);

        const firstPageUrl = buildJudgeMeUrl(
            meta.storeDomain,
            meta.myshopifyDomain,
            meta.productId,
            1
        );

        await requestQueue.addRequest({
            url:      firstPageUrl,
            userData: { type: 'REVIEWS_PAGE', page: 1, meta },
            headers:  {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept':     'text/html,application/xhtml+xml,application/json,*/*',
                'Referer':    meta.cleanUrl,
            },
        });

    } catch (err) {
        log.error(`  Failed to resolve "${rawUrl}": ${err.message}`);
    }
}

// ─── CRAWL ────────────────────────────────────────────────────────────────────
log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
log.info('STEP 2: Scraping Judge.me reviews...');

const crawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency,
    proxyConfiguration: proxyConfig,

    async requestHandler({ request, body }) {
        const { type, page, meta } = request.userData;
        if (type !== 'REVIEWS_PAGE') return;

        log.info(`  Page ${page} → ${meta.productHandle} (${meta.storeDomain})`);

        // ── Unwrap JSON envelope ──────────────────────────────────────────────
        // Judge.me returns: { "html": "<div class='jdgm-rev-widg'...>" }
        // The HTML inside is Unicode-escaped (\u003c = <)
        // We must parse JSON first, then pass html string to Cheerio
        const raw = typeof body === 'string' ? body : body.toString('utf-8');
        let html  = raw;

        try {
            const json = JSON.parse(raw);
            if (json?.html) {
                html = json.html;
                log.info(`    JSON unwrapped ✓  HTML length: ${html.length}`);
            }
        } catch {
            log.info(`    Raw HTML (no JSON wrapper)  Length: ${html.length}`);
        }

        // ── Parse pagination (page 1 only) ────────────────────────────────────
        const { totalReviews, totalPages } = parsePaginationInfo(html);
        const averageRating = parseAverageRating(html);

        if (page === 1) {
            log.info(`    Total reviews: ${totalReviews} | Total pages: ${totalPages} | Avg: ${averageRating}`);
        }

        // ── Parse reviews ─────────────────────────────────────────────────────
        const reviews = parseReviews(html, { ...meta, totalReviews, averageRating });
        log.info(`    Parsed: ${reviews.length} reviews`);

        for (const review of reviews) {
            await Actor.pushData({ ...review, page });
        }

        // ── Enqueue next pages ────────────────────────────────────────────────
        if (page === 1 && totalPages > 1) {
            for (let nextPage = 2; nextPage <= totalPages; nextPage++) {
                // Check maxReviewsPerProduct limit
                const alreadyQueued = (nextPage - 1) * reviews.length;
                if (maxReviewsPerProduct > 0 && alreadyQueued >= maxReviewsPerProduct) {
                    log.info(`    Max reviews limit (${maxReviewsPerProduct}) reached. Stopping pagination.`);
                    break;
                }

                const nextUrl = buildJudgeMeUrl(
                    meta.storeDomain,
                    meta.myshopifyDomain,
                    meta.productId,
                    nextPage
                );

                await requestQueue.addRequest({
                    url:      nextUrl,
                    userData: { type: 'REVIEWS_PAGE', page: nextPage, meta: { ...meta, totalReviews, averageRating } },
                    headers:  {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept':     'text/html,application/xhtml+xml,application/json,*/*',
                        'Referer':    meta.cleanUrl,
                    },
                });
            }
        }
    },

    failedRequestHandler({ request, error }) {
        log.error(`Request failed: ${request.url} — ${error.message}`);
    },
});

await crawler.run();

// ─── EXPORT REVIEWS ───────────────────────────────────────────────────────────
log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
log.info('STEP 3: Exporting reviews...');

const dataset    = await Actor.openDataset();
const { items: allReviews } = await dataset.getData();

log.info(`Total reviews scraped: ${allReviews.length}`);

// 1. Save reviews.json — single combined file
const reviewsPath = resolve(process.cwd(), 'reviews.json');
writeFileSync(reviewsPath, JSON.stringify(allReviews, null, 2), 'utf-8');
log.info(`✅ reviews.json saved → ${reviewsPath}`);

// 2. Save individual numbered files (like other Apify scrapers)
//    output/000000001.json, output/000000002.json, etc.
const outputDir = resolve(process.cwd(), 'output');
mkdirSync(outputDir, { recursive: true });
allReviews.forEach((review, idx) => {
    const fileName = String(idx + 1).padStart(9, '0') + '.json';
    writeFileSync(resolve(outputDir, fileName), JSON.stringify(review, null, 2), 'utf-8');
});
log.info(`✅ ${allReviews.length} individual JSON files saved → output/`);

// 3. Save to Apify Key-Value store (downloadable from Console)
await Actor.setValue('REVIEWS', JSON.stringify(allReviews, null, 2), { contentType: 'application/json' });
log.info('✅ REVIEWS saved to Key-Value store');

// ─── SENTIMENT ANALYSIS ───────────────────────────────────────────────────────
if (enableSentiment && allReviews.length > 0) {
    const groqKey = process.env.GROQ_API_KEY;

    if (!groqKey) {
        log.warning('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log.warning('⚠️  GROQ_API_KEY not set — sentiment skipped.');
        log.warning('    To enable:');
        log.warning('    Local  →  set GROQ_API_KEY=gsk_xxxxx');
        log.warning('    Apify  →  Actor → Settings → Environment Variables');
        log.warning('    Get free key at: https://console.groq.com');
    } else {
        log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log.info('STEP 4: Running AI sentiment analysis (Groq free)...');

        try {
            // Dynamic import so missing file never crashes the scraper
            const { analyzeSentiment, buildReport } = await import('./sentiment_analyzer.js');

            const sentiment = await analyzeSentiment(allReviews);
            const report    = buildReport(allReviews, sentiment);

            // Save locally
            const reportPath = resolve(process.cwd(), 'sentiment_report.json');
            writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
            log.info(`✅ sentiment_report.json saved → ${reportPath}`);

            // Save to Apify Key-Value store
            await Actor.setValue('SENTIMENT_REPORT', JSON.stringify(report, null, 2), { contentType: 'application/json' });
            log.info('✅ SENTIMENT_REPORT saved to Key-Value store');

            log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            log.info(`🎯 Sentiment:   ${sentiment.overallSentiment} (${sentiment.sentimentScore}/100)`);
            log.info(`💡 Key Insight: ${sentiment.keyInsight}`);
            log.info(`📣 Summary:     ${sentiment.summary}`);

        } catch (err) {
            log.error(`Sentiment analysis failed: ${err.message}`);
            log.error('Scraping completed successfully — only sentiment step failed.');
        }
    }
} else if (allReviews.length === 0) {
    log.warning('No reviews scraped — skipping sentiment.');
} else {
    log.info('Sentiment analysis disabled (enableSentiment: false).');
}

// ─── DONE ─────────────────────────────────────────────────────────────────────
log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
log.info('🏁 ALL DONE!');
log.info(`   📄 reviews.json           → ${allReviews.length} reviews`);
log.info(`   📊 sentiment_report.json  → AI analysis`);
log.info(`   🌐 Open report_viewer.html and drop sentiment_report.json`);
log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await Actor.exit();