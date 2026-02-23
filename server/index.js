import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import recommendationsRouter from './routes/recommendations.js';
import productsRouter from './routes/products.js';
import { createGraphQLClient } from './utils/shopifyClient.js';
import { syncApiUrlMetafield } from './utils/metafieldUtils.js';
import { ensureSessionInstance, validateSession } from './utils/sessionUtils.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_FILE = path.join(__dirname, '..', '.session-dev.json');

const app = express();
const PORT = process.env.PORT || 3000;

function getPublicAppUrl() {
  const host = (process.env.SHOPIFY_HOST || '').replace(/^https?:\/\//, '');
  return host ? `https://${host}` : '';
}

function getFrontendBaseUrl() {
  const configuredUrl = process.env.FRONTEND_URL;
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }
  return '';
}

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(',') || ['read_products', 'write_products'],
  hostName: process.env.SHOPIFY_HOST?.replace(/https?:\/\//, '') || 'localhost',
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  isCustomStoreApp: false,
});

// Middleware
app.set('trust proxy', true);

// Ensure preflight responses always include origin headers (some tunnel edges
// drop/alter OPTIONS behavior, so we set explicit CORS headers here).
app.use((req, res, next) => {
  if (req.method !== 'OPTIONS') return next();

  const requestOrigin = req.headers.origin;
  if (requestOrigin) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
    res.header('Vary', 'Origin, Access-Control-Request-Headers');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] ||
      'Content-Type, Authorization, ngrok-skip-browser-warning, Bypass-Tunnel-Reminder, bypass-tunnel-reminder'
  );

  return res.status(204).end();
});

// Request Logging Middleware
app.use((req, res, next) => {
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Middleware
// Middleware
const corsOptions = {
  origin: true,
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
    'Bypass-Tunnel-Reminder',
    'bypass-tunnel-reminder',
  ],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Enable pre-flight for all routes with same config

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Public app config for frontend initialization
app.get('/api/config', (req, res) => {
  res.json({
    apiKey: process.env.SHOPIFY_API_KEY || '',
  });
});

// Root route - Redirect to frontend or show re-auth
app.get('/', (req, res) => {
  const shop = req.query.shop || (global.activeSession ? global.activeSession.shop : '');
  const host = req.query.host;

  // In development, redirect only when an explicit frontend URL is configured.
  if (process.env.NODE_ENV === 'development' && shop && host) {
    const frontendBaseUrl = getFrontendBaseUrl();
    if (frontendBaseUrl) {
      const targetUrl = new URL('/', frontendBaseUrl);
      targetUrl.searchParams.set('shop', String(shop));
      targetUrl.searchParams.set('host', String(host));
      const currentHost = req.get('host');

      if (targetUrl.host === currentHost) {
        console.log('ℹ️  Frontend URL matches current host; skipping redirect to avoid loop.');
      } else {
        console.log(`🚀 Redirecting to frontend URL: ${targetUrl.toString()}`);
        return res.redirect(targetUrl.toString());
      }
    }
  }

  // Fallback UI
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Shopify Recommendations App</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f6f6f7; }
          .container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 100%; }
          h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #202223; }
          p { color: #6d7175; margin-bottom: 1.5rem; }
          input { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #c9cccf; border-radius: 4px; box-sizing: border-box; }
          button { background-color: #008060; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 4px; cursor: pointer; font-weight: 500; width: 100%; }
          button:hover { background-color: #004c3f; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>App is Running 🚀</h1>
          <p>Please enter your shop domain to access the dashboard or re-authenticate.</p>
          <form action="/auth" method="GET" target="_top">
            <input type="text" name="shop" placeholder="my-shop.myshopify.com" value="${shop}" required>
            <button type="submit">Go to Dashboard</button>
          </form>
        </div>
        <script>
           // If we have a shop but no host, and we are in an iframe, we might need App Bridge
           if (window.top !== window.self && "${shop}") {
             console.log("App loaded in iframe without host parameter.");
           }
        </script>
      </body>
    </html>
  `);
});

// Auth routes
app.get('/auth', async (req, res) => {
  try {
    const shop = req.query.shop;

    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }

    const authRoute = await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });

    // Check if we are in an iframe
    if (req.query.embedded === '1' || req.headers['sec-fetch-dest'] === 'iframe') {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <script>
              window.top.location.href = "${authRoute}";
            </script>
          </head>
          <body>
            <p>Redirecting to Shopify for authentication...</p>
            <a href="${authRoute}" target="_top">Click here if not redirected</a>
          </body>
        </html>
      `);
    }

    if (!res.headersSent) {
      res.redirect(authRoute);
    }
  } catch (error) {
    console.error('Auth error:', error);
    if (!res.headersSent) {
      res.status(500).send(error.message);
    }
  }
});

// Shopfy API initialized above

// Make shopify instance available to routes and utils
app.set('shopify', shopify);
global.shopifyInstance = shopify;

// Helper to load session
async function loadSession() {
  try {
    const data = await fs.readFile(SESSION_FILE, 'utf8');
    const sessionData = JSON.parse(data);
    const session = ensureSessionInstance(sessionData);
    const validation = validateSession(session);

    if (!validation.valid) {
      global.activeSession = null;
      console.log(`⚠️  Stored session is not valid (${validation.reason}). Re-authentication is required.`);
      if (validation.missingScopes.length > 0) {
        console.log(`⚠️  Missing scopes: ${validation.missingScopes.join(', ')}`);
      }
      return null;
    }

    global.activeSession = validation.session;
    console.log('✅ Loaded valid session from file');

    // Sync API URL to storefront metafields
    const apiUrl = getPublicAppUrl();
    if (apiUrl) {
      const client = createGraphQLClient(validation.session);
      const syncSuccess = await syncApiUrlMetafield(client, apiUrl);
      if (syncSuccess === false) {
        console.log('⚠️  Could not sync API URL metafield on startup. Continuing with active session.');
      }
    } else {
      console.log('⚠️  SHOPIFY_HOST is missing; skipped API URL metafield sync.');
    }

    return validation.session;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Error loading session:', err);
    return null;
  }
}

// ... (existing routes)

// Auth Callback
app.get('/auth/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;

    // Store session
    const validation = validateSession(session);
    if (!validation.valid) {
      global.activeSession = null;
      return res.status(401).send(
        `Session is missing required permissions (${validation.missingScopes.join(', ')}). Please reinstall or re-authenticate the app.`
      );
    }

    global.activeSession = validation.session;

    // Persist to file
    await fs.writeFile(SESSION_FILE, JSON.stringify(validation.session, null, 2));
    console.log('💾 Saved session to file');

    const host = req.query.host;
    if (!res.headersSent) {
      // Sync API URL to storefront metafields before redirecting
      const apiUrl = getPublicAppUrl();
      if (apiUrl) {
        const client = createGraphQLClient(validation.session);
        await syncApiUrlMetafield(client, apiUrl);
      }

      const params = new URLSearchParams({ shop: validation.session.shop });
      if (host) {
        params.set('host', String(host));
      }
      res.redirect(`/?${params.toString()}`);
    }
  } catch (error) {
    console.error('Callback error:', error);
    if (!res.headersSent) {
      res.status(500).send(error.message);
    }
  }
});

// API Routes
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/products', productsRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'));

  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'dist' });
  });
}

// Start server
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Auth URL: http://localhost:${PORT}/auth`);

  // Try loading session on start
  try {
    const session = await loadSession();
    if (session) {
      console.log(`✅ Active session for: ${session.shop}`);
    } else {
      console.log('⚠️  No active session found on startup.');
    }
  } catch (err) {
    console.error('❌ Failed to load session during startup:', err);
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 UNCaught Server Error:', err);

  // Create an error log file
  try {
    fs.appendFile('CRITICAL_ERRORS.log', `[${new Date().toISOString()}] ${err.message}\n${err.stack}\n\n`, () => { });
  } catch (e) { }

  if (!res.headersSent) {
    res.status(500).json({
      error: true,
      message: 'A critical server error occurred',
      details: err.message
    });
  }
});

export default app;
