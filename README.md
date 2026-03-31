# 🕵️ Judge.me Reviews Scraper + AI Sentiment Intelligence

> **The only Shopify review scraper that doesn't just collect data — it tells you what it means.**

---

## What This Does

Most review scrapers give you a spreadsheet and leave you staring at 200 rows trying to figure out if customers actually like the product.

This one doesn't.

It scrapes every review from any Shopify store running Judge.me — then runs an AI layer on top that reads all of them collectively and hands you a finished intelligence report: what customers love, what they complain about, who is buying, and the single most important insight buried in the data.

One run. Two outputs. Zero guesswork.

---

## Who This Is For

- **Shopify store owners** who want to know what their own customers are really saying beyond star averages
- **Dropshippers & product researchers** validating demand before investing in a niche
- **E-commerce agencies** doing competitor audits at scale
- **Brand analysts** tracking sentiment shifts over time
- **Amazon-to-Shopify scouts** who need social proof intelligence fast

---

## Input

Paste any Shopify product URL. Messy, clean, with collections path, with variant params — it doesn't matter. The scraper cleans it automatically.

```json
{
  "productUrls": [
    "https://anystore.com/collections/skincare/products/best-serum?variant=123",
    "https://anotherstore.com/products/face-cream"
  ],
  "maxReviewsPerProduct": 0,
  "enableSentiment": true
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `productUrls` | list | required | Any Shopify product URLs |
| `maxReviewsPerProduct` | number | `0` (unlimited) | Cap per product |
| `maxConcurrency` | number | `3` | Parallel requests |
| `enableSentiment` | boolean | `true` | Run AI analysis layer |

---

## Output

### Every review — structured and clean

```json
{
  "reviewId": "464b78f3-1cb7-42c2-9701-29615d230cca",
  "reviewerName": "Simran Kaur",
  "rating": 5,
  "ratingLabel": "5 Stars",
  "headline": "Amazing Glow Serum",
  "body": "I didn't expect this serum result so amazing. I highly recommend to all.",
  "date": "2026-02-26 07:12:36 UTC",
  "verified": "Store Visitor",
  "productUrl": "https://nourishmantra.in/products/best-serum-for-glowing-skin",
  "productId": "7120389472427",
  "storeDomain": "nourishmantra.in",
  "totalReviews": 20,
  "averageRating": 4.8,
  "scrapedAt": "2026-03-01T10:00:00.000Z"
}
```

### The AI Sentiment Report — what the data actually says

```json
{
  "sentiment": {
    "overallSentiment": "Positive",
    "sentimentScore": 87,
    "summary": "Customers overwhelmingly praise the serum's hydration and visible glow results, with multiple reviewers noting immediate skin softness. The product appears to consistently meet or exceed expectations for its price point.",
    "topPraises": [
      "instant hydration",
      "visible glow",
      "skin feels soft"
    ],
    "topComplaints": [
      "no complaints found"
    ],
    "commonThemes": [
      "hydration",
      "glow results",
      "skin texture improvement"
    ],
    "buyerPersona": "Primarily Indian women aged 20–35 seeking affordable skincare with visible results. First-time buyers who become repeat customers after seeing quick effects.",
    "productStrengths": [
      "fast visible results",
      "affordable price",
      "texture and feel"
    ],
    "productWeaknesses": [],
    "recommendationRate": 95,
    "emotionalTone": "delighted",
    "keyInsight": "Every reviewer mentions skin softness or glow within days of use — this product's speed of results is its strongest competitive differentiator."
  },
  "stats": {
    "averageRating": 4.8,
    "ratingDistribution": { "5": 17, "4": 2, "3": 1, "2": 0, "1": 0 },
    "verifiedBuyers": 8,
    "storeVisitors": 12,
    "verifiedPercentage": 40.0
  }
}
```

---


**Powered by Groq (free).** No paid AI subscription required. Add your free Groq API key in environment variables and the analysis runs automatically inside every scrape.

---


## Limitations

- Only works on Shopify stores that have the **Judge.me** reviews app installed
- Review data is public — only reviews visible on the product page are scraped
- Very new products with 0 reviews will return an empty dataset

---

*Built for researchers, operators, and anyone who needs to understand what customers actually think — not just count how many stars they clicked.*