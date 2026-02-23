# Advanced Configuration Guide

## Custom Recommendation Logic

### 1. Modify Scoring Algorithm

Edit `server/utils/recommendationEngine.js`:

```javascript
function calculateRelevanceScore(matchingVariants, targetPrice, targetSize) {
  let score = 50; // Base score

  // Customize price scoring (currently max 25 points)
  const avgPrice = matchingVariants.reduce((sum, v) => sum + v.price, 0) / matchingVariants.length;
  const priceDifference = Math.abs(avgPrice - targetPrice);
  
  // Make price more/less important
  const priceWeight = 30; // Increase from 25 to make price more important
  const priceScore = Math.max(0, priceWeight - (priceDifference / targetPrice) * priceWeight);
  score += priceScore;

  // Add custom scoring criteria
  // Example: Bonus for products with high review ratings
  const hasGoodReviews = checkProductReviews(matchingVariants[0].product_id);
  if (hasGoodReviews) {
    score += 10;
  }

  return Math.round(score);
}
```

### 2. Add Color Matching

```javascript
// In recommendationEngine.js

function findMatchingVariants(variants, targetSize, priceMin, priceMax, targetColor = null) {
  return variants.filter(variant => {
    // Existing checks...
    
    // Add color matching
    if (targetColor) {
      const hasMatchingColor = variant.selectedOptions.some(option => {
        const optionName = option.name.toLowerCase();
        const optionValue = option.value.toLowerCase();
        return optionName === 'color' && optionValue === targetColor.toLowerCase();
      });
      
      if (!hasMatchingColor) return false;
    }
    
    return hasMatchingSize;
  });
}
```

### 3. Implement Brand Filtering

```javascript
// Filter by brand/vendor
export function filterRecommendationsByBrand(products, criteria) {
  const { preferredBrands = [] } = criteria;
  
  if (preferredBrands.length === 0) {
    return products;
  }
  
  return products.filter(product => 
    preferredBrands.includes(product.vendor)
  );
}
```

## Custom API Endpoints

### Add a "Trending Products" Endpoint

Create `server/routes/trending.js`:

```javascript
import express from 'express';
import NodeCache from 'node-cache';

const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

router.get('/trending', async (req, res) => {
  try {
    const { limit = 10, category } = req.query;
    
    // Check cache
    const cacheKey = `trending_${category || 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ products: cached, cached: true });
    }

    // Fetch products and sort by custom criteria
    const session = global.activeSession;
    const client = createGraphQLClient(session);
    
    // Your custom trending logic here
    const trendingProducts = await getTrendingProducts(client, { category, limit });
    
    cache.set(cacheKey, trendingProducts);
    res.json({ products: trendingProducts, cached: false });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

Register in `server/index.js`:
```javascript
import trendingRouter from './routes/trending.js';
app.use('/api/trending', trendingRouter);
```

## Frontend Customization

### Custom Product Card Design

Edit `extensions/product-recommendations/blocks/product-recommendations.liquid`:

```liquid
<style>
.recommendation-card {
  /* Your custom styles */
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 15px;
  overflow: hidden;
}

.recommendation-card__title {
  font-family: 'Your Custom Font', sans-serif;
  font-size: 1.2rem;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
}

/* Add hover animations */
.recommendation-card:hover {
  transform: scale(1.05) rotate(-1deg);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
```

### Add "Quick Add to Cart" Button

```liquid
<button class="quick-add-btn" 
        onclick="addToCart('${firstVariant.id}')">
  Quick Add - $${firstVariant.price.toFixed(2)}
</button>

<script>
function addToCart(variantId) {
  fetch('/cart/add.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: variantId,
      quantity: 1
    })
  })
  .then(() => {
    // Trigger cart drawer or notification
    alert('Added to cart!');
  });
}
</script>
```

## Performance Optimization

### 1. Implement Redis Caching

Install Redis:
```bash
npm install redis
```

Create `server/utils/redisCache.js`:
```javascript
import { createClient } from 'redis';

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', err => console.log('Redis Client Error', err));
await client.connect();

export async function cacheGet(key) {
  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
}

export async function cacheSet(key, value, ttl = 300) {
  await client.setEx(key, ttl, JSON.stringify(value));
}

export default client;
```

### 2. Implement Query Batching

```javascript
// Batch multiple product queries into one
export async function batchGetProducts(client, productIds) {
  const query = `
    query getMultipleProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          variants(first: 50) { ... }
        }
      }
    }
  `;
  
  const data = await executeQuery(client, query, {
    ids: productIds.map(id => 
      id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`
    )
  });
  
  return data.nodes.filter(Boolean);
}
```

## Analytics Integration

### Track Recommendation Clicks

Add to your Liquid template:

```javascript
function trackRecommendationClick(productId, recommendationType) {
  // Google Analytics
  gtag('event', 'recommendation_click', {
    'product_id': productId,
    'recommendation_type': recommendationType
  });
  
  // Or custom endpoint
  fetch('/api/analytics/recommendation-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: productId,
      type: recommendationType,
      timestamp: Date.now()
    })
  });
}
```

### Create Analytics Dashboard

Create `server/routes/analytics.js`:

```javascript
router.get('/analytics/recommendations', async (req, res) => {
  const { startDate, endDate } = req.query;
  
  // Query your analytics database
  const stats = await getRecommendationStats(startDate, endDate);
  
  res.json({
    totalClicks: stats.clicks,
    conversion Rate: stats.conversions / stats.clicks,
    topRecommendedProducts: stats.topProducts,
    revenueGenerated: stats.revenue
  });
});
```

## Environment-Specific Configuration

### Development
```env
NODE_ENV=development
PRICE_RANGE_PERCENTAGE=25
MAX_RECOMMENDATIONS=10
CACHE_TTL=60
LOG_LEVEL=debug
```

### Staging
```env
NODE_ENV=staging
PRICE_RANGE_PERCENTAGE=20
MAX_RECOMMENDATIONS=8
CACHE_TTL=300
LOG_LEVEL=info
```

### Production
```env
NODE_ENV=production
PRICE_RANGE_PERCENTAGE=20
MAX_RECOMMENDATIONS=8
CACHE_TTL=600
LOG_LEVEL=error
REDIS_URL=redis://your-redis-server:6379
```

## Custom Recommendation Rules

### Example: "Frequently Bought Together"

```javascript
export async function getFrequentlyBoughtTogether(client, productId) {
  // Query orders to find products frequently purchased together
  const query = `
    query {
      orders(first: 100, query: "line_items.product_id:${productId}") {
        edges {
          node {
            lineItems(first: 10) {
              edges {
                node {
                  product {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  
  // Process and aggregate results
  const frequencyMap = {};
  // ... count product occurrences
  
  return topProducts;
}
```

## Testing Configuration

### Unit Tests Example

Create `tests/recommendationEngine.test.js`:

```javascript
import { filterRecommendations } from '../server/utils/recommendationEngine.js';

describe('Recommendation Engine', () => {
  test('filters products by size and price', () => {
    const products = [/* mock products */];
    const criteria = {
      targetSize: 'M',
      targetPrice: 29.99,
      priceRangePercentage: 20
    };
    
    const results = filterRecommendations(products, criteria);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchingVariants.length).toBeGreaterThan(0);
  });
});
```

Run tests:
```bash
npm install --save-dev jest
npm test
```

## Webhook Integration

### Stock Level Monitoring

```javascript
app.post('/webhooks/inventory-update', async (req, res) => {
  const { product_id, variant_id, available } = req.body;
  
  if (available === 0) {
    // Clear recommendations cache for this product
    await clearProductRecommendations(product_id);
  }
  
  res.status(200).send('OK');
});
```

Register webhook in Shopify:
```bash
shopify webhook create --topic INVENTORY_LEVELS_UPDATE --address https://your-app-url.com/webhooks/inventory-update
```

---

**Remember**: Always test changes in development before deploying to production!
