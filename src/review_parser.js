/**
 * review_parser.js
 * ─────────────────────────────────────────────────────────────
 * Parses the HTML returned inside Judge.me's JSON envelope.
 *
 * Judge.me response format:
 *   { "html": "<div class='jdgm-rev-widg'...>...</div>" }
 *
 * Confirmed CSS selectors from live Judge.me widget HTML:
 *   Reviews container : [data-review-id]
 *   Rating            : .jdgm-rev__rating[data-score]
 *   Reviewer name     : .jdgm-rev__author
 *   Title             : .jdgm-rev__title
 *   Body              : .jdgm-rev__body p
 *   Date              : .jdgm-rev__timestamp[data-content]
 *   Verified badge    : .jdgm-rev__buyer-badge
 *   Pagination        : .jdgm-paginate__page
 *   Total count       : [data-number-of-reviews]
 */

import * as cheerio from 'cheerio';

// ─── PAGINATION INFO ──────────────────────────────────────────────────────────
export function parsePaginationInfo(html) {
    const $ = cheerio.load(html);

    // Total reviews
    let totalReviews = 0;
    const countAttr = $('[data-number-of-reviews]').first().attr('data-number-of-reviews');
    if (countAttr) totalReviews = parseInt(countAttr, 10) || 0;

    // Total pages — from pagination links
    let totalPages = 1;

    // Method 1: data-number-of-pages attribute
    const pagesAttr = $('[data-number-of-pages]').first().attr('data-number-of-pages');
    if (pagesAttr) totalPages = Math.max(totalPages, parseInt(pagesAttr, 10) || 1);

    // Method 2: highest page number in pagination buttons
    $('.jdgm-paginate__page').each((_, el) => {
        const n = parseInt($(el).text().trim(), 10);
        if (!isNaN(n) && n > totalPages) totalPages = n;
    });

    return { totalReviews, totalPages };
}

// ─── AVERAGE RATING ───────────────────────────────────────────────────────────
export function parseAverageRating(html) {
    const $     = cheerio.load(html);
    const score = $('[data-average-rating]').first().attr('data-average-rating')
               || $('.jdgm-overall-star').first().attr('data-score');
    return score ? parseFloat(score) : null;
}

// ─── PARSE ALL REVIEWS FROM ONE PAGE ─────────────────────────────────────────
export function parseReviews(html, meta = {}) {
    const $       = cheerio.load(html);
    const reviews = [];

    $('[data-review-id]').each((idx, el) => {
        try {
            const $el = $(el);

            // ── Star rating ───────────────────────────────────────────────────
            const ratingRaw = $el.find('.jdgm-rev__rating').attr('data-score')
                           || $el.find('[data-score]').first().attr('data-score');
            const rating = ratingRaw ? parseFloat(ratingRaw) : null;

            // ── Reviewer name ─────────────────────────────────────────────────
            const reviewerName = $el.find('.jdgm-rev__author').first().text().trim() || 'Anonymous';

            // ── Title / headline ──────────────────────────────────────────────
            const headline = $el.find('.jdgm-rev__title').first().text().trim() || '(No Title)';

            // ── Review body ───────────────────────────────────────────────────
            const body = $el.find('.jdgm-rev__body p').first().text().trim()
                      || $el.find('.jdgm-rev__body').first().text().trim()
                      || null;

            // ── Date ──────────────────────────────────────────────────────────
            const dateEl = $el.find('.jdgm-rev__timestamp').first();
            const date   = dateEl.attr('data-content')
                        || dateEl.attr('datetime')
                        || dateEl.text().trim()
                        || null;

            // ── Verified / store visitor ──────────────────────────────────────
            let verified = 'Unknown';
            const verifiedAttr = $el.attr('data-verified-buyer');
            const badgeText    = $el.find('.jdgm-rev__buyer-badge').first().text().trim();

            if (badgeText) {
                verified = badgeText;
            } else if (verifiedAttr === 'true') {
                verified = 'Verified Buyer';
            } else if (verifiedAttr === 'false') {
                verified = 'Store Visitor';
            }

            // ── Review ID ─────────────────────────────────────────────────────
            const reviewId = $el.attr('data-review-id') || `${meta.productId || 'p'}_${idx}`;

            reviews.push({
                reviewId,
                reviewerName,
                rating,
                ratingLabel:  rating ? `${rating} Star${rating !== 1 ? 's' : ''}` : null,
                headline,
                body,
                date,
                verified,
                productUrl:   meta.cleanUrl     || null,
                productId:    meta.productId    || null,
                storeDomain:  meta.storeDomain  || null,
                totalReviews: meta.totalReviews || null,
                averageRating:meta.averageRating|| null,
                scrapedAt:    new Date().toISOString(),
            });

        } catch {
            // skip malformed review silently
        }
    });

    return reviews;
}