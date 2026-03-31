/**
 * url_utils.js
 * ─────────────────────────────────────────────────────────────
 * Handles:
 *   1. Cleaning messy Shopify URLs  →  canonical product URL
 *   2. Fetching numeric product ID  →  Shopify /products/<handle>.json
 *   3. Fetching myshopify domain    →  Shopify /meta.json
 *   4. Building Judge.me API URLs   →  judge.me/reviews/reviews_for_widget
 *
 * KEY INSIGHT:
 *   Judge.me requires TWO different domains:
 *     url         = custom domain        e.g.  "nourishmantra.in"
 *     shop_domain = myshopify domain     e.g.  "nourishmantra.myshopify.com"
 *   Sending the custom domain for both returns empty HTML (0 reviews).
 */

// ─── 1. PARSE & CLEAN SHOPIFY URL ────────────────────────────────────────────
/**
 * Strips /collections/..., /search/..., query params, fragments.
 *
 * Input:  https://store.com/collections/serums/products/best-serum?variant=123
 * Output: { storeDomain, productHandle, canonicalUrl, cleanUrl }
 */
export function parseShopifyProductUrl(rawUrl) {
    let url = rawUrl.trim();

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid URL: "${rawUrl}"`);
    }

    const storeDomain  = parsed.hostname;
    const productMatch = parsed.pathname.match(/\/products\/([^/?#]+)/);

    if (!productMatch) {
        throw new Error(`No /products/<handle> found in URL: "${rawUrl}"`);
    }

    const productHandle = productMatch[1];
    const canonicalUrl  = `${storeDomain}/products/${productHandle}`;

    return {
        storeDomain,
        productHandle,
        canonicalUrl,
        cleanUrl: `https://${canonicalUrl}`,
    };
}

// ─── 2. FETCH PRODUCT ID ─────────────────────────────────────────────────────
/**
 * Gets the numeric Shopify product ID from the public product JSON endpoint.
 * Every Shopify store exposes /products/<handle>.json publicly.
 */
export async function fetchProductId(storeDomain, productHandle) {
    const url = `https://${storeDomain}/products/${productHandle}.json`;

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ApifyBot/1.0)',
            'Accept':     'application/json',
        },
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch product JSON (HTTP ${res.status}): ${url}`);
    }

    const data      = await res.json();
    const productId = data?.product?.id;

    if (!productId) {
        throw new Error(`product.id not found in response from: ${url}`);
    }

    return String(productId);
}

// ─── 3. FETCH MYSHOPIFY DOMAIN ───────────────────────────────────────────────
/**
 * Gets the permanent *.myshopify.com domain from /meta.json.
 * This is what Judge.me uses as shop_domain.
 *
 * e.g.  nourishmantra.in  →  nourishmantra.myshopify.com
 */
export async function fetchMyshopifyDomain(storeDomain) {
    const url = `https://${storeDomain}/meta.json`;

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ApifyBot/1.0)',
            'Accept':     'application/json',
        },
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch meta.json (HTTP ${res.status}): ${url}`);
    }

    const data            = await res.json();
    const myshopifyDomain = data?.myshopify_domain;

    if (!myshopifyDomain) {
        throw new Error(`myshopify_domain not found in /meta.json for: ${storeDomain}`);
    }

    return myshopifyDomain;
}

// ─── 4. BUILD JUDGE.ME URL ───────────────────────────────────────────────────
/**
 * Constructs the Judge.me widget API URL for a specific page.
 *
 * @param {string} storeDomain     - e.g. "nourishmantra.in"
 * @param {string} myshopifyDomain - e.g. "nourishmantra.myshopify.com"
 * @param {string} productId       - numeric Shopify product ID
 * @param {number} page            - page number (1-based)
 * @param {number} perPage         - reviews per page (default 10)
 */
export function buildJudgeMeUrl(storeDomain, myshopifyDomain, productId, page = 1, perPage = 10) {
    const params = new URLSearchParams({
        url:         storeDomain,
        shop_domain: myshopifyDomain,
        platform:    'shopify',
        product_id:  productId,
        page:        String(page),
        per_page:    String(perPage),
    });

    return `https://judge.me/reviews/reviews_for_widget?${params.toString()}`;
}

// ─── 5. RESOLVE ALL PRODUCT INFO ─────────────────────────────────────────────
/**
 * Master function — takes a raw user URL and returns everything needed.
 * Fetches productId and myshopifyDomain in parallel for speed.
 */
export async function resolveProductInfo(rawUrl) {
    const { storeDomain, productHandle, canonicalUrl, cleanUrl } = parseShopifyProductUrl(rawUrl);

    const [productId, myshopifyDomain] = await Promise.all([
        fetchProductId(storeDomain, productHandle),
        fetchMyshopifyDomain(storeDomain),
    ]);

    return {
        rawUrl,
        cleanUrl,
        storeDomain,
        myshopifyDomain,
        productHandle,
        productId,
        canonicalUrl,
    };
}