/**
 * sentiment_analyzer.js
 * ─────────────────────────────────────────────────────────────
 * AI-powered sentiment analysis using Groq (100% FREE).
 *
 * Used in two ways:
 *   1. Imported by main.js  →  runs automatically after scraping
 *   2. Standalone CLI       →  node src/sentiment_analyzer.js --input reviews.json
 *
 * Setup (one time):
 *   1. Go to https://console.groq.com → sign up free (no credit card)
 *   2. API Keys → Create API Key → copy it
 *   3. Set it:
 *        Windows:    set GROQ_API_KEY=gsk_xxxxx
 *        Mac/Linux:  export GROQ_API_KEY=gsk_xxxxx
 *        Apify:      Actor → Settings → Environment Variables → GROQ_API_KEY
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const GROQ_MODEL = 'llama3-70b-8192';

// ─── GROQ API CALL ────────────────────────────────────────────────────────────
async function callGroq(prompt) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
        throw new Error(
            'GROQ_API_KEY not set.\n' +
            'Get your free key at https://console.groq.com\n' +
            'Then: set GROQ_API_KEY=gsk_xxxxx  (Windows)\n' +
            '   or: export GROQ_API_KEY=gsk_xxxxx  (Mac/Linux)\n' +
            '   or: Apify → Actor Settings → Environment Variables'
        );
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model:       GROQ_MODEL,
            temperature: 0.2,
            max_tokens:  4096,
            messages: [
                {
                    role:    'system',
                    content: 'You are an expert product review analyst. Always respond with valid JSON only. No markdown, no explanation, no code fences. Raw JSON only.',
                },
                { role: 'user', content: prompt },
            ],
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Groq API error HTTP ${res.status}: ${err}`);
    }

    const data  = await res.json();
    const text  = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json\n?|```\n?/g, '').trim();

    try {
        return JSON.parse(clean);
    } catch {
        throw new Error(`Groq returned invalid JSON:\n${clean.slice(0, 500)}`);
    }
}

// ─── PER-REVIEW ANALYSIS (batched) ───────────────────────────────────────────
async function analyzePerReview(reviews) {
    const BATCH_SIZE = 40;
    let   perReview  = [];

    for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
        const batch      = reviews.slice(i, i + BATCH_SIZE);
        const batchNum   = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatch = Math.ceil(reviews.length / BATCH_SIZE);

        console.log(`   [${batchNum}/${totalBatch}] Analyzing ${batch.length} reviews...`);

        const lines = batch.map((r, idx) =>
            `ID:${r.reviewId ?? idx} | Stars:${r.rating ?? '?'}/5 | Title:"${r.headline ?? ''}" | Body:"${r.body ?? ''}"`
        ).join('\n');

        const result = await callGroq(`
Analyze these product reviews. Return a JSON array — one object per review, same order as input:

${lines}

Each object must have EXACTLY these fields:
{
  "reviewId":  "<same ID from input, as string>",
  "sentiment": "Positive" | "Negative" | "Neutral" | "Mixed",
  "score":     <integer 0-100, where 100 = most positive>,
  "keyPhrase": "<most important thing this reviewer said, max 8 words>",
  "emotions":  ["<emotion1>", "<emotion2>"]
}

Return ONLY the JSON array. Nothing else.`);

        if (Array.isArray(result)) {
            perReview = perReview.concat(result);
        }

        // Respect Groq free rate limits
        if (i + BATCH_SIZE < reviews.length) {
            await new Promise(r => setTimeout(r, 700));
        }
    }

    return perReview;
}

// ─── COLLECTIVE ANALYSIS ──────────────────────────────────────────────────────
async function analyzeCollective(reviews) {
    const lines = reviews.map(r =>
        `[${r.rating ?? '?'}★] "${r.headline ?? ''}" — ${r.body ?? ''}`
    ).join('\n');

    return await callGroq(`
You are analyzing ${reviews.length} customer reviews for a product.

REVIEWS:
${lines}

Return a single JSON object with EXACTLY these fields:
{
  "overallSentiment":  "Positive" | "Negative" | "Mixed" | "Neutral",
  "sentimentScore":    <integer 0-100>,
  "summary":           "<2-3 sentences: what are ALL reviewers collectively saying>",
  "topPraises":        ["<phrase>", "<phrase>", "<phrase>"],
  "topComplaints":     ["<phrase>"],
  "commonThemes":      ["<theme>", "<theme>", "<theme>"],
  "buyerPersona":      "<1-2 sentences: who is buying this product based on reviews>",
  "productStrengths":  ["<strength>", "<strength>", "<strength>"],
  "productWeaknesses": ["<weakness>"],
  "recommendationRate":<integer 0-100, estimated % of reviewers who recommend>,
  "emotionalTone":     "<single dominant emotion word>",
  "keyInsight":        "<the single most important insight from all reviews, 1 sentence>"
}

Return ONLY the JSON object. Nothing else.`);
}

// ─── EXPORTED: analyzeSentiment ──────────────────────────────────────────────
export async function analyzeSentiment(reviews) {
    console.log(`\n🔍 Per-review sentiment (${reviews.length} reviews in batches of 40)...`);
    const perReview = await analyzePerReview(reviews);

    console.log('🧠 Collective intelligence report...');
    const collective = await analyzeCollective(reviews);

    return { ...collective, perReview };
}

// ─── EXPORTED: buildReport ───────────────────────────────────────────────────
export function buildReport(reviews, sentiment) {
    // Rating distribution
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) {
        if (r.rating) dist[Math.round(r.rating)]++;
    }

    // Average rating
    const rated     = reviews.filter(r => r.rating);
    const avgRating = rated.length
        ? rated.reduce((s, r) => s + r.rating, 0) / rated.length
        : 0;

    // Verified counts
    const verified = reviews.filter(r => r.verified?.toLowerCase().includes('verified')).length;
    const visitor  = reviews.filter(r => r.verified?.toLowerCase().includes('visitor')).length;

    // Unique products
    const products = [...new Set(reviews.map(r => r.productUrl || r.storeDomain).filter(Boolean))];

    // Merge sentiment back into each review
    const enriched = reviews.map((r, idx) => {
        const sa = sentiment.perReview?.find(
            p => String(p.reviewId) === String(r.reviewId ?? idx)
        ) || {};
        return {
            ...r,
            sentimentAnalysis: {
                sentiment: sa.sentiment || null,
                score:     sa.score     || null,
                keyPhrase: sa.keyPhrase || null,
                emotions:  sa.emotions  || [],
            },
        };
    });

    return {
        meta: {
            generatedAt:  new Date().toISOString(),
            totalReviews: reviews.length,
            products,
            model:        `Groq / ${GROQ_MODEL}`,
            dateRange: {
                oldest: reviews.map(r => r.date).filter(Boolean).sort()[0]            || null,
                newest: reviews.map(r => r.date).filter(Boolean).sort().reverse()[0]  || null,
            },
        },
        stats: {
            averageRating:       parseFloat(avgRating.toFixed(2)),
            ratingDistribution:  dist,
            verifiedBuyers:      verified,
            storeVisitors:       visitor,
            verifiedPercentage:  parseFloat(((verified / reviews.length) * 100).toFixed(1)),
        },
        sentiment: {
            overallSentiment:   sentiment.overallSentiment,
            sentimentScore:     sentiment.sentimentScore,
            summary:            sentiment.summary,
            topPraises:         sentiment.topPraises         || [],
            topComplaints:      sentiment.topComplaints       || [],
            commonThemes:       sentiment.commonThemes        || [],
            buyerPersona:       sentiment.buyerPersona,
            productStrengths:   sentiment.productStrengths    || [],
            productWeaknesses:  sentiment.productWeaknesses   || [],
            recommendationRate: sentiment.recommendationRate,
            emotionalTone:      sentiment.emotionalTone,
            keyInsight:         sentiment.keyInsight,
        },
        reviews: enriched,
    };
}

// ─── STANDALONE CLI MODE ──────────────────────────────────────────────────────
// Run directly: node src/sentiment_analyzer.js --input reviews.json
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('src/sentiment_analyzer.js');

if (isMain) {
    if (!process.env.GROQ_API_KEY) {
        console.error(`
❌  GROQ_API_KEY not set!

Steps to get your FREE Groq API key:
  1. Go to https://console.groq.com
  2. Sign up (free, no credit card needed)
  3. Click "API Keys" → "Create API Key" → copy it
  4. Then run:
       Windows:    set GROQ_API_KEY=gsk_xxxxx
       Mac/Linux:  export GROQ_API_KEY=gsk_xxxxx
  5. Run this script again.
`);
        process.exit(1);
    }

    const args   = process.argv.slice(2);
    const getArg = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
    const inFile = getArg('--input');
    const outFile= getArg('--output') || 'sentiment_report.json';

    // Load reviews
    let reviews;

    if (inFile && existsSync(inFile)) {
        const raw = readFileSync(inFile, 'utf-8').trim();
        try   { reviews = JSON.parse(raw); }
        catch { reviews = raw.split('\n').filter(Boolean).map(l => JSON.parse(l)); }
        console.log(`📂 Loaded ${reviews.length} reviews from ${inFile}`);

    } else {
        // Auto-detect Apify local dataset
        const datasetDir = resolve(process.cwd(), 'storage/datasets/default');
        if (existsSync(datasetDir)) {
            const files = readdirSync(datasetDir).filter(f => f.endsWith('.json')).sort();
            reviews = files.map(f => JSON.parse(readFileSync(resolve(datasetDir, f), 'utf-8')));
            console.log(`📂 Loaded ${reviews.length} reviews from Apify dataset`);
        } else {
            console.error('❌ No reviews found. Use --input reviews.json  OR run the scraper first.');
            process.exit(1);
        }
    }

    if (!reviews.length) {
        console.error('❌ 0 reviews found — nothing to analyze.');
        process.exit(1);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Judge.me Sentiment Analyzer');
    console.log('  Powered by Groq (FREE — llama3-70b)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const sentiment = await analyzeSentiment(reviews);
    const report    = buildReport(reviews, sentiment);

    const outPath = resolve(process.cwd(), outFile);
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`\n✅ Report saved → ${outPath}`);
    console.log(`\n🎯 Sentiment:   ${sentiment.overallSentiment} (${sentiment.sentimentScore}/100)`);
    console.log(`⭐ Avg Rating:  ${report.stats.averageRating}/5`);
    console.log(`💡 Key Insight: ${sentiment.keyInsight}`);
    console.log(`📣 Summary:     ${sentiment.summary}`);
    console.log(`\n👉 Open report_viewer.html and drop in ${outFile}\n`);
}