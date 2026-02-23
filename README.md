# 🛍️ Shopify Smart Recommendations App

A powerful Shopify app that provides intelligent product recommendations based on size, price, and product attributes. Perfect for increasing average order value and improving customer experience.

## ✨ Features

- **Product Page Recommendations**: Show similar products when customers view a product
- **Cart Recommendations**: Suggest complementary items based on cart contents
- **Smart Filtering**: Matches by:
  - Exact or similar size
  - Price range (±20% configurable)
  - Product type and category
  - Tags and attributes
- **Performance**: Built-in caching for fast load times
- **Responsive Design**: Works beautifully on all devices
- **Easy Integration**: Simple theme extensions

## 🏗️ Architecture

```
├── server/                 # Node.js/Express backend
│   ├── index.js           # Main server file
│   ├── routes/            # API routes
│   │   ├── recommendations.js
│   │   └── products.js
│   └── utils/             # Utilities
│       ├── shopifyClient.js
│       ├── productQueries.js
│       └── recommendationEngine.js
├── src/                   # React frontend (admin interface)
│   ├── App.jsx
│   ├── main.jsx
│   └── components/
│       └── Dashboard.jsx
├── extensions/            # Shopify theme extensions
│   ├── product-recommendations/
│   └── cart-recommendations/
└── launch.js             # Automated deployment script
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- Shopify Partner account
- Development store
- Cloudflared installed ([Download](https://github.com/cloudflare/cloudflared))
- Shopify CLI installed (`npm install -g @shopify/cli @shopify/app`)

### Installation

1. **Clone or create the project directory**:
```bash
mkdir shopify-recommendations-app
cd shopify-recommendations-app
```

2. **Install dependencies**:
```bash
npm install
```

3. **Configure environment**:
```bash
cp .env.example .env
```

Edit `.env` and add your Shopify credentials:
```env
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SHOPIFY_HOST=will-be-auto-updated
SCOPES=read_products,write_products,read_content,write_content
PORT=3000
```

4. **Update shopify.app.toml**:
```toml
name = "product-recommendations"
client_id = "your_client_id_from_partner_dashboard"
dev_store_url = "your-store.myshopify.com"
```

### 🎯 One-Command Launch

```bash
npm run launch
```

This automated script will:
1. ✅ Kill any process on port 3000
2. 🌐 Start Cloudflare tunnel
3. 📝 Update configuration files automatically
4. ☁️  Deploy to Shopify
5. 🚀 Start the development server

## 📋 Manual Setup (Alternative)

If you prefer manual setup:

```bash
# Terminal 1: Start Cloudflare tunnel
cloudflared tunnel --url http://localhost:3000

# Terminal 2: Update configs with your tunnel URL, then run
npm run dev

# Terminal 3: Deploy to Shopify
shopify app deploy
```

## 🔌 API Endpoints

### Get Product Recommendations
```
GET /api/recommendations/product/:productId?size=M&price=29.99
```

**Parameters:**
- `productId` (required): Shopify product ID
- `size` (required): Size to match (e.g., "M", "Large")
- `price` (required): Target price

**Response:**
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
      "relevanceScore": 85,
      "reason": "Available in size M, similar price",
      "priceRange": {
        "min": 27.99,
        "max": 32.99
      }
    }
  ],
  "cached": false
}
```

### Get Cart Recommendations
```
POST /api/recommendations/cart
```

**Body:**
```json
{
  "items": [
    {
      "variant_id": 123456,
      "product_id": 789012,
      "variant_title": "M / Blue",
      "price": 29.99,
      "properties": {}
    }
  ]
}
```

### Clear Cache
```
DELETE /api/recommendations/cache
```

## 🎨 Frontend Integration

### Add to Product Page

1. Go to your Shopify admin
2. Navigate to **Online Store > Themes > Customize**
3. On a product page, click **Add section**
4. Select **Product Recommendations**
5. Configure heading and settings
6. Save

### Add to Cart Page

1. In theme editor, go to **Cart** template
2. Click **Add section**
3. Select **Cart Recommendations**
4. Configure settings
5. Save

## ⚙️ Configuration

### Environment Variables

```env
# Recommendation behavior
PRICE_RANGE_PERCENTAGE=20    # ±20% price range
MAX_RECOMMENDATIONS=8         # Maximum results
CACHE_TTL=300                # Cache duration (seconds)
```

### Customizing the Algorithm

Edit `server/utils/recommendationEngine.js`:

```javascript
// Adjust scoring weights
const priceScore = Math.max(0, 25 - (priceDifference / targetPrice) * 25);
const availabilityScore = (availableCount / matchingVariants.length) * 15;
```

## 🧪 Testing

### Test via Admin Dashboard

1. Open app in Shopify admin
2. Enter test values:
   - Product ID: `7234567890123`
   - Size: `M`
   - Price: `29.99`
3. Click "Get Recommendations"

### Test via API

```bash
curl "http://localhost:3000/api/recommendations/product/7234567890123?size=M&price=29.99"
```

## 📊 How the Recommendation Engine Works

1. **Extract Criteria**: Get size and price from selected variant
2. **Filter Products**: Query products of same type
3. **Match Variants**: Find variants with matching size
4. **Price Range**: Filter by ±20% price range
5. **Score & Rank**: Calculate relevance score (0-100)
6. **Return Top Results**: Sort by score, return top 8

### Scoring Algorithm

- **Base Score**: 50 points
- **Price Proximity**: Up to 25 points (closer = higher)
- **Availability**: Up to 15 points (more variants = higher)
- **Exact Size Match**: 10 point bonus

## 🐛 Troubleshooting

### Port Already in Use
```bash
# The launch script handles this automatically, but manually:
# On Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# On Mac/Linux:
lsof -ti:3000 | xargs kill -9
```

### Authentication Issues
1. Check API credentials in `.env`
2. Verify app is installed on development store
3. Clear browser cache and reinstall app

### No Recommendations Showing
1. Check browser console for errors
2. Verify API URL in metafields
3. Ensure products have size variants
4. Check cache: `DELETE /api/recommendations/cache`

### Tunnel Not Working
```bash
# Verify cloudflared is installed
cloudflared --version

# Try manual tunnel first
cloudflared tunnel --url http://localhost:3000
```

## 🚢 Production Deployment

### Option 1: Heroku

```bash
heroku create your-app-name
heroku config:set SHOPIFY_API_KEY=your_key
heroku config:set SHOPIFY_API_SECRET=your_secret
git push heroku main
```

### Option 2: Railway

```bash
railway login
railway init
railway up
```

### Option 3: DigitalOcean/AWS

1. Deploy Node.js app
2. Set environment variables
3. Update `shopify.app.toml` with production URL
4. Run `shopify app deploy`

## 📝 Todo / Future Enhancements

- [ ] Add ML-based recommendations
- [ ] Support for more filter criteria (color, brand)
- [ ] A/B testing functionality
- [ ] Analytics dashboard
- [ ] Email notifications for popular products
- [ ] Multi-language support
- [ ] Inventory-aware recommendations

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - feel free to use this for your own projects!

## 🆘 Support

Need help?
- Check the [Shopify App Development docs](https://shopify.dev/docs/apps)
- Review the troubleshooting section above
- Open an issue on GitHub

## 🎉 Credits

Built with:
- [Shopify App CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify Polaris](https://polaris.shopify.com/)
- [Express.js](https://expressjs.com/)
- [React](https://react.dev/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

---

Made with ❤️ for the Shopify developer community
