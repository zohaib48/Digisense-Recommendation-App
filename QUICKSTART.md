# 🚀 Quick Start Guide

Get your Shopify Recommendations App running in **5 minutes**!

## Prerequisites Checklist

Before starting, make sure you have:

- ✅ Node.js 18+ installed ([Download](https://nodejs.org/))
- ✅ Shopify Partner account ([Sign up](https://partners.shopify.com/))
- ✅ A development store created
- ✅ Cloudflared installed ([Instructions below](#install-cloudflared))
- ✅ Shopify CLI installed ([Instructions below](#install-shopify-cli))

## Step 1: Install Cloudflared

### macOS
```bash
brew install cloudflare/cloudflare/cloudflared
```

### Windows
Download from: https://github.com/cloudflare/cloudflared/releases

### Linux
```bash
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

Verify installation:
```bash
cloudflared --version
```

## Step 2: Install Shopify CLI

```bash
npm install -g @shopify/cli @shopify/app
```

Verify installation:
```bash
shopify version
```

## Step 3: Create Shopify App

1. Go to [Shopify Partners](https://partners.shopify.com/)
2. Click **Apps** > **Create app**
3. Choose **Public app** or **Custom app**
4. Fill in app details:
   - App name: "Product Recommendations"
   - App URL: `https://temporary-url.com` (will be updated later)
5. Click **Create app**
6. Note your **API key** and **API secret**

## Step 4: Configure the App

Run the setup wizard:

```bash
cd shopify-recommendations-app
npm run setup
```

The setup will ask for:
- Shopify API Key
- Shopify API Secret  
- Development Store URL (e.g., `mystore.myshopify.com`)

## Step 5: Launch the App

```bash
npm run launch
```

This single command will:
1. Kill any process on port 3000
2. Start Cloudflare tunnel
3. Auto-update configuration files
4. Deploy to Shopify
5. Start the development server

**You're done!** 🎉

## Step 6: Install on Your Store

1. The terminal will show an **Auth URL**
2. Copy the Auth URL and open it in your browser
3. Click **Install** when prompted
4. You'll be redirected to the app dashboard

## Step 7: Add to Your Theme

### Product Page Recommendations

1. Go to **Online Store** > **Themes** > **Customize**
2. Navigate to any **Product page**
3. Click **Add section** in the sidebar
4. Choose **Apps** > **Product Recommendations**
5. Customize the heading and settings
6. Click **Save**

### Cart Page Recommendations

1. In the theme editor, go to the **Cart** page
2. Click **Add section**
3. Choose **Apps** > **Cart Recommendations**
4. Customize the heading and settings
5. Click **Save**

## Testing

1. Open your store
2. Go to any product page
3. Select a size and see recommendations appear!

## Troubleshooting

### Port 3000 is already in use
The launch script handles this automatically, but if needed:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3000 | xargs kill -9
```

### "No active session" error
1. Make sure you've installed the app on your store
2. Go through the OAuth flow by visiting the auth URL
3. Check that API credentials in `.env` are correct

### Recommendations not showing
1. Open browser console (F12) to check for errors
2. Verify products have size variants
3. Check the API URL is set correctly
4. Try clearing cache: 
   ```bash
   curl -X DELETE http://localhost:3000/api/recommendations/cache
   ```

### Tunnel not working
```bash
# Test tunnel manually first
cloudflared tunnel --url http://localhost:3000

# If this works, your launch script should work too
```

## What's Next?

- **Customize the algorithm**: Edit `server/utils/recommendationEngine.js`
- **Adjust settings**: Modify `.env` variables
- **Style the widgets**: Edit the Liquid files in `extensions/`
- **Add analytics**: Track recommendation clicks and conversions

## Support

- 📖 [Full Documentation](README.md)
- 🐛 [Report Issues](https://github.com/your-repo/issues)
- 💬 [Shopify Community](https://community.shopify.com/)

---

**Congratulations!** Your recommendation system is now live 🎊
