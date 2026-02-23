# Project Structure

Complete overview of the Shopify Recommendations App file structure.

```
shopify-recommendations-app/
│
├── 📄 launch.js                    # Automated deployment script
├── 📄 setup.js                     # Initial setup wizard
├── 📄 package.json                 # Node.js dependencies
├── 📄 vite.config.js              # Vite configuration
├── 📄 index.html                   # HTML entry point
├── 📄 .env.example                 # Environment variables template
├── 📄 .env                         # Your environment variables (git-ignored)
├── 📄 .gitignore                   # Git ignore rules
├── 📄 shopify.app.toml            # Shopify app configuration
├── 📄 README.md                    # Main documentation
├── 📄 QUICKSTART.md               # Quick start guide
├── 📄 ADVANCED_CONFIG.md          # Advanced configuration
├── 📄 API_DOCS.md                 # API documentation
│
├── 📁 server/                      # Backend (Node.js/Express)
│   ├── 📄 index.js                # Main server file
│   │
│   ├── 📁 routes/                 # API routes
│   │   ├── 📄 recommendations.js  # Recommendation endpoints
│   │   └── 📄 products.js         # Product endpoints
│   │
│   └── 📁 utils/                  # Utility functions
│       ├── 📄 shopifyClient.js    # GraphQL client setup
│       ├── 📄 productQueries.js   # Product data fetching
│       └── 📄 recommendationEngine.js  # Core recommendation logic
│
├── 📁 src/                         # Frontend (React)
│   ├── 📄 main.jsx                # React entry point
│   ├── 📄 App.jsx                 # Main App component
│   │
│   └── 📁 components/             # React components
│       └── 📄 Dashboard.jsx       # Admin dashboard
│
└── 📁 extensions/                  # Shopify theme extensions
    ├── 📁 product-recommendations/ # Product page widget
    │   └── 📁 blocks/
    │       └── 📄 product-recommendations.liquid
    │
    └── 📁 cart-recommendations/    # Cart page widget
        └── 📁 blocks/
            └── 📄 cart-recommendations.liquid
```

---

## File Descriptions

### Root Files

#### `launch.js` 🚀
**Purpose**: Automated deployment script that handles the entire startup process.

**What it does**:
- Kills any process using port 3000
- Starts Cloudflare tunnel
- Captures tunnel URL
- Updates `shopify.app.toml` and `.env` files
- Deploys app to Shopify
- Starts the development server

**Usage**: `npm run launch`

---

#### `setup.js` 🛠️
**Purpose**: Interactive setup wizard for first-time configuration.

**What it does**:
- Collects Shopify credentials
- Creates `.env` file
- Updates `shopify.app.toml`
- Checks for dependencies
- Provides next steps

**Usage**: `npm run setup`

---

#### `package.json` 📦
**Purpose**: Node.js project configuration and dependencies.

**Key dependencies**:
- `@shopify/shopify-api`: Shopify API library
- `@shopify/polaris`: UI components
- `express`: Web server
- `react`: Frontend framework
- `node-cache`: Caching
- `vite`: Build tool

**Scripts**:
```json
{
  "setup": "node setup.js",
  "launch": "node launch.js",
  "dev": "node server/index.js",
  "build": "vite build"
}
```

---

#### `shopify.app.toml` ⚙️
**Purpose**: Shopify app configuration file.

**Contains**:
- App name and client ID
- Application URL
- Redirect URLs
- Access scopes
- Webhook configuration

**Auto-updated by**: `launch.js` script

---

#### `.env` 🔐
**Purpose**: Environment variables (sensitive data).

**Contains**:
- API credentials
- Server configuration
- Recommendation settings

**Never commit this file!**

---

### Server Directory

#### `server/index.js` 🖥️
**Purpose**: Main Express server and app entry point.

**Responsibilities**:
- Initialize Shopify API
- Setup middleware (CORS, JSON parsing)
- Define auth routes
- Register API routes
- Error handling
- Start server

**Routes**:
- `GET /health` - Health check
- `GET /auth` - OAuth initiation
- `GET /auth/callback` - OAuth callback
- `/api/recommendations/*` - Recommendation routes
- `/api/products/*` - Product routes

---

#### `server/routes/recommendations.js` 🎯
**Purpose**: Handle all recommendation-related API endpoints.

**Endpoints**:
1. `GET /api/recommendations/product/:productId`
   - Get recommendations for a product
   - Filters by size and price
   - Returns scored results

2. `POST /api/recommendations/cart`
   - Get recommendations for cart items
   - Aggregates from multiple items
   - Removes duplicates

3. `GET /api/recommendations/similar/:productId`
   - Get similar products by tags
   - Alternative recommendation method

4. `DELETE /api/recommendations/cache`
   - Clear recommendation cache

**Features**:
- Request caching
- Error handling
- Session validation

---

#### `server/routes/products.js` 📦
**Purpose**: Product data fetching endpoints.

**Endpoints**:
- `GET /api/products/:productId` - Single product
- `GET /api/products` - Product list with filters
- `POST /api/products/search` - Product search

---

#### `server/utils/shopifyClient.js` 🔗
**Purpose**: GraphQL client creation and query execution.

**Functions**:
- `createGraphQLClient(session)` - Creates client
- `executeQuery(client, query, variables)` - Runs queries

**Handles**:
- GraphQL errors
- Response parsing
- Session management

---

#### `server/utils/productQueries.js` 📊
**Purpose**: GraphQL queries for product data.

**Functions**:
- `getProductDetails(client, productId)` - Single product
- `getProductsByFilters(client, filters)` - Filtered products
- `searchProducts(client, query, limit)` - Product search
- `getProductVariants(client, productId)` - Product variants

**GraphQL Queries**:
- Full product data with variants
- Images, prices, options
- Tags, vendor, product type

---

#### `server/utils/recommendationEngine.js` 🧠
**Purpose**: Core recommendation algorithm and filtering logic.

**Main Functions**:

1. `filterRecommendations(products, criteria)`
   - Filters products by criteria
   - Scores relevance (0-100)
   - Sorts and limits results

2. `findMatchingVariants(variants, size, priceMin, priceMax)`
   - Finds variants matching size
   - Checks price range
   - Verifies availability

3. `calculateRelevanceScore(matchingVariants, targetPrice, targetSize)`
   - Base score: 50 points
   - Price proximity: 0-25 points
   - Availability: 0-15 points
   - Exact size match: +10 bonus

4. `generateRecommendationReason(matchingVariants, targetSize, targetPrice)`
   - Creates human-readable explanation

**Scoring Algorithm**:
```
Total Score (0-100):
├── Base: 50
├── Price: 0-25 (closer = higher)
├── Availability: 0-15 (more = higher)
└── Exact Match: +10 bonus
```

---

### Frontend Directory

#### `src/main.jsx` 🎨
**Purpose**: React application entry point.

**What it does**:
- Imports React and ReactDOM
- Renders root App component
- Wraps in StrictMode

---

#### `src/App.jsx` 🌐
**Purpose**: Main React application component.

**Responsibilities**:
- Initialize App Bridge
- Handle authentication
- Load configuration
- Render dashboard

**State Management**:
- Config (API key, host)
- Loading state
- Error handling

---

#### `src/components/Dashboard.jsx` 📊
**Purpose**: Admin dashboard interface.

**Features**:
1. **Testing Interface**:
   - Test product recommendations
   - Input: Product ID, Size, Price
   - Display results in table

2. **Cache Management**:
   - Clear cache button
   - Status feedback

3. **Configuration Display**:
   - Current settings
   - API endpoints
   - How it works

**UI Components** (Shopify Polaris):
- Page, Layout, Card
- TextField, Button
- DataTable, Banner
- Badge, Text

---

### Extensions Directory

#### `extensions/product-recommendations/blocks/product-recommendations.liquid` 🛒
**Purpose**: Product page recommendation widget.

**What it displays**:
- Recommendations grid
- Product cards with:
  - Image
  - Title
  - Price
  - Match quality badge
  - Reason for recommendation

**How it works**:
1. Extracts current product data
2. Gets selected variant size and price
3. Calls API: `/api/recommendations/product/:id`
4. Renders recommendations dynamically

**Customizable** (Theme Editor):
- Heading text
- Empty state message
- Styling

**JavaScript**:
- Fetches recommendations on load
- Updates when variant changes
- Handles errors gracefully

---

#### `extensions/cart-recommendations/blocks/cart-recommendations.liquid` 🛍️
**Purpose**: Cart page recommendation widget.

**What it displays**:
- Similar to product page widget
- Based on all cart items
- "Complete Your Look" style

**How it works**:
1. Fetches cart data: `GET /cart.js`
2. Sends cart items to API
3. Displays aggregated recommendations
4. Removes duplicates

**Features**:
- Listens for cart updates
- Quick view product button
- Match quality indicators

---

## Data Flow

### Product Page Recommendations

```
User views product
       ↓
Selects size/variant
       ↓
JavaScript extracts:
- Product ID
- Size
- Price
       ↓
API call to /api/recommendations/product/:id
       ↓
Server:
1. Gets product details
2. Queries similar products
3. Filters by size & price
4. Scores relevance
5. Returns top 8
       ↓
JavaScript renders:
- Product cards
- Images
- Prices
- Match badges
```

### Cart Recommendations

```
User adds items to cart
       ↓
Visits cart page
       ↓
JavaScript fetches cart.js
       ↓
Extracts all items:
- Product IDs
- Sizes
- Prices
       ↓
API call to /api/recommendations/cart
       ↓
Server processes each item:
1. Get recommendations for each
2. Aggregate all results
3. Remove duplicates
4. Sort by relevance
       ↓
JavaScript renders combined recommendations
```

---

## Technology Stack

### Backend
- **Framework**: Express.js
- **Language**: Node.js (ES Modules)
- **API**: Shopify GraphQL API
- **Caching**: node-cache (in-memory)
- **HTTP Client**: Built-in fetch

### Frontend
- **Framework**: React 18
- **UI Library**: Shopify Polaris
- **Build Tool**: Vite
- **App Bridge**: Shopify App Bridge React

### Deployment
- **Tunnel**: Cloudflare Tunnel
- **CLI**: Shopify CLI
- **Hosting**: Any Node.js host (Heroku, Railway, etc.)

---

## Key Concepts

### 1. Recommendation Algorithm
- Filters by exact/similar size
- Price range matching (±20%)
- Relevance scoring (0-100)
- Product type filtering

### 2. Caching Strategy
- 5-minute TTL for recommendations
- Cache keys include all parameters
- Manual cache clearing available

### 3. Theme Extensions
- Liquid templates
- JavaScript for dynamic content
- Shopify Theme Editor compatible
- Customizable via settings

### 4. OAuth Flow
1. User installs app
2. Redirected to `/auth`
3. Shopify OAuth
4. Callback to `/auth/callback`
5. Session stored
6. Redirect to app

---

## Development Workflow

1. **Setup**: Run `npm run setup`
2. **Launch**: Run `npm run launch`
3. **Develop**: Edit files, server auto-restarts
4. **Test**: Use admin dashboard or API directly
5. **Deploy**: Push to production host
6. **Install**: Add to theme via Theme Editor

---

## Environment Variables Reference

```env
# Shopify Configuration
SHOPIFY_API_KEY=your_api_key           # From Partner Dashboard
SHOPIFY_API_SECRET=your_secret         # From Partner Dashboard
SHOPIFY_HOST=tunnel-url.com            # Auto-updated
SCOPES=read_products,write_products    # Required scopes

# Server
PORT=3000                              # Server port
NODE_ENV=development                   # Environment

# Recommendations
PRICE_RANGE_PERCENTAGE=20              # ±20% price range
MAX_RECOMMENDATIONS=8                  # Results limit
CACHE_TTL=300                          # 5 minutes
```

---

## Customization Points

### Easy to Customize:
- ✅ Recommendation criteria (size, price range)
- ✅ UI styling (Liquid templates)
- ✅ Score weights (recommendationEngine.js)
- ✅ Cache duration
- ✅ Result limits

### Requires More Work:
- 🔧 Add new filter types (color, brand)
- 🔧 Machine learning integration
- 🔧 Custom recommendation algorithms
- 🔧 Analytics dashboard
- 🔧 A/B testing

---

For detailed information on each component, see:
- [README.md](README.md) - Main documentation
- [QUICKSTART.md](QUICKSTART.md) - Getting started
- [API_DOCS.md](API_DOCS.md) - API reference
- [ADVANCED_CONFIG.md](ADVANCED_CONFIG.md) - Advanced usage

---

**Ready to customize?** Start by editing `server/utils/recommendationEngine.js`! 🚀
