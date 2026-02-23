# API Documentation

Complete reference for the Shopify Recommendations App API.

## Base URL

```
Development: http://localhost:3000
Production: https://your-app-url.com
```

## Authentication

All API requests require an active Shopify session. The app handles OAuth automatically when installed.

---

## Endpoints

### 1. Get Product Recommendations

Get personalized recommendations for a specific product based on size and price.

**Endpoint:** `GET /api/recommendations/product/:productId`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| productId | string | Yes | Shopify product ID or GID |
| size | string | Yes | Size to match (e.g., "M", "Large", "XL") |
| price | number | Yes | Target price in store currency |
| variantId | string | No | Specific variant ID (optional) |

**Example Request:**
```bash
GET /api/recommendations/product/7234567890123?size=M&price=29.99
```

**Example Response:**
```json
{
  "recommendations": [
    {
      "id": "gid://shopify/Product/7234567890124",
      "title": "Classic Cotton T-Shirt",
      "handle": "classic-cotton-tshirt",
      "description": "Premium cotton t-shirt...",
      "productType": "T-Shirts",
      "tags": ["cotton", "casual", "summer"],
      "vendor": "Brand Name",
      "images": [
        {
          "id": "gid://shopify/ProductImage/...",
          "url": "https://cdn.shopify.com/...",
          "altText": "Product image"
        }
      ],
      "variants": [
        {
          "id": "gid://shopify/ProductVariant/...",
          "title": "M / Blue",
          "price": 28.99,
          "compareAtPrice": null,
          "sku": "TSH-M-BLU",
          "availableForSale": true,
          "selectedOptions": [
            { "name": "Size", "value": "M" },
            { "name": "Color", "value": "Blue" }
          ]
        }
      ],
      "matchingVariants": [
        {
          "id": "gid://shopify/ProductVariant/...",
          "title": "M / Blue",
          "price": 28.99,
          "availableForSale": true,
          "selectedOptions": [
            { "name": "Size", "value": "M" },
            { "name": "Color", "value": "Blue" }
          ]
        }
      ],
      "priceRange": {
        "min": 28.99,
        "max": 32.99,
        "currencyCode": "USD"
      },
      "relevanceScore": 85,
      "reason": "Available in size M, similar price"
    }
  ],
  "cached": false,
  "filters": {
    "size": "M",
    "price": 29.99,
    "productType": "T-Shirts"
  }
}
```

**Status Codes:**
- `200` - Success
- `400` - Missing required parameters
- `401` - No active session
- `404` - Product not found
- `500` - Server error

---

### 2. Get Cart Recommendations

Get recommendations based on all items currently in the cart.

**Endpoint:** `POST /api/recommendations/cart`

**Request Body:**
```json
{
  "items": [
    {
      "variant_id": 40234567890123,
      "product_id": 7234567890123,
      "variant_title": "M / Blue",
      "price": 29.99,
      "properties": {
        "Size": "M",
        "Color": "Blue"
      }
    }
  ]
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3000/api/recommendations/cart \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "variant_id": 40234567890123,
        "product_id": 7234567890123,
        "variant_title": "M / Blue",
        "price": 29.99
      }
    ]
  }'
```

**Example Response:**
```json
{
  "recommendations": [
    {
      "id": "gid://shopify/Product/...",
      "title": "Product Name",
      "handle": "product-handle",
      "images": [...],
      "variants": [...],
      "matchingVariants": [...],
      "priceRange": {...},
      "relevanceScore": 82,
      "reason": "Available in size M, 10% cheaper"
    }
  ],
  "cached": false,
  "cartItemsProcessed": 3
}
```

**Status Codes:**
- `200` - Success
- `400` - Invalid request body
- `401` - No active session
- `500` - Server error

---

### 3. Get Similar Products

Get similar products based on tags and product type (alternative recommendation method).

**Endpoint:** `GET /api/recommendations/similar/:productId`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| productId | string | Yes | Shopify product ID or GID |
| limit | number | No | Max results (default: 6) |

**Example Request:**
```bash
GET /api/recommendations/similar/7234567890123?limit=10
```

**Example Response:**
```json
{
  "similar": [
    {
      "id": "gid://shopify/Product/...",
      "title": "Similar Product",
      "handle": "similar-product",
      "productType": "T-Shirts",
      "tags": ["cotton", "casual"],
      "images": [...],
      "variants": [...],
      "priceRange": {...}
    }
  ],
  "basedOn": {
    "tags": ["cotton", "casual", "summer"],
    "productType": "T-Shirts"
  }
}
```

---

### 4. Clear Recommendations Cache

Clear the recommendation cache. Useful after updating products or settings.

**Endpoint:** `DELETE /api/recommendations/cache`

**Example Request:**
```bash
curl -X DELETE http://localhost:3000/api/recommendations/cache
```

**Example Response:**
```json
{
  "success": true,
  "message": "Cache cleared successfully"
}
```

**Status Codes:**
- `200` - Success
- `500` - Server error

---

### 5. Get Product Details

Retrieve detailed information about a specific product.

**Endpoint:** `GET /api/products/:productId`

**Example Request:**
```bash
GET /api/products/7234567890123
```

**Example Response:**
```json
{
  "product": {
    "id": "gid://shopify/Product/7234567890123",
    "title": "Product Name",
    "handle": "product-handle",
    "description": "Product description...",
    "productType": "T-Shirts",
    "tags": ["tag1", "tag2"],
    "vendor": "Brand Name",
    "images": [...],
    "variants": [...],
    "priceRange": {...}
  }
}
```

---

### 6. Search Products

Search for products by query string.

**Endpoint:** `POST /api/products/search`

**Request Body:**
```json
{
  "query": "blue shirt",
  "limit": 20
}
```

**Example Response:**
```json
{
  "products": [...],
  "count": 15,
  "query": "blue shirt"
}
```

---

### 7. Get Products with Filters

Fetch products with optional filters.

**Endpoint:** `GET /api/products`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| productType | string | No | Filter by product type |
| tags | string | No | Comma-separated tags |
| limit | number | No | Max results (default: 50) |

**Example Request:**
```bash
GET /api/products?productType=T-Shirts&tags=cotton,casual&limit=20
```

---

## Relevance Score

The relevance score (0-100) indicates how well a product matches the criteria:

- **80-100**: Excellent match (exact size, very close price)
- **60-79**: Good match (exact size, close price)
- **40-59**: Fair match (similar size or price)
- **0-39**: Poor match (significant differences)

### Score Calculation

```
Base Score: 50 points

+ Price Proximity: 0-25 points
  - Closer to target price = higher score
  - Formula: 25 - (|price_diff| / target_price * 25)

+ Availability: 0-15 points
  - More available variants = higher score
  - Formula: (available_count / total_count) * 15

+ Exact Size Match: 10 points bonus
  - Awarded for exact size string match

Total: 0-100 points
```

---

## Rate Limiting

Current rate limits:

- **Development**: No limits
- **Production**: 
  - 100 requests per minute per IP
  - 1000 requests per hour per shop

---

## Error Responses

All errors follow this format:

```json
{
  "error": true,
  "message": "Error description here"
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - No active session |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

---

## Caching

The API implements caching for performance:

- **Product Recommendations**: Cached for 5 minutes (configurable via `CACHE_TTL`)
- **Product Details**: Cached for 10 minutes
- **Search Results**: Cached for 5 minutes

Cache keys include all query parameters to ensure accurate results.

### Cache Invalidation

Cache is automatically cleared when:
- Products are updated (via webhook)
- Manual cache clear is triggered
- Cache TTL expires

---

## Webhooks

The app can listen to Shopify webhooks for real-time updates:

### Supported Webhooks

```javascript
// Product update
POST /webhooks/products/update

// Product delete
POST /webhooks/products/delete

// Inventory update
POST /webhooks/inventory-levels/update
```

**Webhook Payload Example:**
```json
{
  "id": 7234567890123,
  "title": "Product Name",
  "variants": [...],
  "updated_at": "2024-02-16T10:00:00Z"
}
```

---

## GraphQL Schema

The app uses Shopify's GraphQL API. Key queries:

### Get Product
```graphql
query getProduct($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    variants(first: 100) {
      edges {
        node {
          id
          price
          selectedOptions {
            name
            value
          }
        }
      }
    }
  }
}
```

### Search Products
```graphql
query searchProducts($query: String!) {
  products(first: 50, query: $query) {
    edges {
      node {
        id
        title
        productType
        tags
      }
    }
  }
}
```

---

## SDK Example (JavaScript)

```javascript
class RecommendationsAPI {
  constructor(baseURL) {
    this.baseURL = baseURL;
  }

  async getProductRecommendations(productId, size, price) {
    const response = await fetch(
      `${this.baseURL}/api/recommendations/product/${productId}?size=${size}&price=${price}`
    );
    return await response.json();
  }

  async getCartRecommendations(cartItems) {
    const response = await fetch(
      `${this.baseURL}/api/recommendations/cart`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cartItems })
      }
    );
    return await response.json();
  }

  async clearCache() {
    const response = await fetch(
      `${this.baseURL}/api/recommendations/cache`,
      { method: 'DELETE' }
    );
    return await response.json();
  }
}

// Usage
const api = new RecommendationsAPI('http://localhost:3000');
const recs = await api.getProductRecommendations('7234567890123', 'M', 29.99);
```

---

## Testing with cURL

```bash
# Get product recommendations
curl "http://localhost:3000/api/recommendations/product/7234567890123?size=M&price=29.99"

# Get cart recommendations
curl -X POST http://localhost:3000/api/recommendations/cart \
  -H "Content-Type: application/json" \
  -d '{"items":[{"variant_id":40234567890123,"product_id":7234567890123,"price":29.99}]}'

# Clear cache
curl -X DELETE http://localhost:3000/api/recommendations/cache

# Get product details
curl "http://localhost:3000/api/products/7234567890123"

# Search products
curl -X POST http://localhost:3000/api/products/search \
  -H "Content-Type: application/json" \
  -d '{"query":"blue shirt","limit":10}'
```

---

## Postman Collection

Import this collection for easy testing:

```json
{
  "info": {
    "name": "Shopify Recommendations API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Get Product Recommendations",
      "request": {
        "method": "GET",
        "url": {
          "raw": "{{baseUrl}}/api/recommendations/product/:productId?size=M&price=29.99",
          "host": ["{{baseUrl}}"],
          "path": ["api", "recommendations", "product", ":productId"]
        }
      }
    }
  ]
}
```

---

For more information, see the [main documentation](README.md).
