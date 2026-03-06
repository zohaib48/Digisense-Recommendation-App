import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import recommendationsRouter from './routes/recommendations.js';
import productsRouter from './routes/products.js';
import settingsRouter from './routes/settings.js';
import syncRouter from './routes/sync.js';
import webhooksRouter, { verifyWebhookHmac } from './routes/webhooks.js';
import { createGraphQLClient } from './utils/shopifyClient.js';
import { syncApiUrlMetafield } from './utils/metafieldUtils.js';
import { ensureSessionInstance, validateSession } from './utils/sessionUtils.js';
import { syncAllProducts, syncSettings } from './utils/syncProducts.js';
import { storeSession, findSessionByShop } from './db/sessionStore.js';
import pool from './db/pool.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function isUnauthorizedError(error) {
  return (
    error?.statusCode === 401 ||
    error?.code === 401 ||
    error?.response?.code === 401
  );
}

async function verifySessionAuthorization(session) {
  try {
    const client = createGraphQLClient(session);
    await client.query({
      data: {
        query: `query AuthProbe { shop { id } }`,
      },
    });
    return true;
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return false;
    }

    // Non-auth failures can be transient (network/tunnel). Keep session usable.
    console.warn('⚠️  Could not verify session authorization with Shopify:', error.message);
    return true;
  }
}

// ============================================================
// App Proxy Signature Verification
// ============================================================

/**
 * Verify the signature on Shopify app proxy requests.
 * Shopify sends query params with a signature that must be verified.
 */
function verifyAppProxySignature(queryParams) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const signature = queryParams.signature;
  if (!signature) return false;

  // Build the sorted query string (excluding 'signature' itself)
  const sortedParams = Object.keys(queryParams)
    .filter(key => key !== 'signature')
    .sort()
    .map(key => {
      const value = queryParams[key];
      return `${key}=${Array.isArray(value) ? value.join(',') : value}`;
    })
    .join('');

  const calculatedSignature = crypto
    .createHmac('sha256', secret)
    .update(sortedParams)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(signature)
  );
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

// ============================================================
// Security Headers Middleware
// ============================================================

app.use((req, res, next) => {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions policy
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
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

// CORS — restrict to Shopify and app domains
const allowedOriginPatterns = [
  /\.myshopify\.com$/,
  /\.shopify\.com$/,
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, webhooks, app proxy)
    if (!origin) return callback(null, true);

    // Allow Shopify admin and store domains
    try {
      const originHost = new URL(origin).hostname;
      const isAllowed = allowedOriginPatterns.some(pattern => pattern.test(originHost));

      // Also allow the app's own domain
      const appHost = (process.env.SHOPIFY_HOST || '').replace(/^https?:\/\//, '');
      if (appHost && originHost === appHost) return callback(null, true);

      // In development, be more permissive
      if (process.env.NODE_ENV === 'development') return callback(null, true);

      if (isAllowed) return callback(null, true);
    } catch (e) {
      // Invalid URL — deny
    }

    callback(null, false);
  },
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

// ⚡ Webhook routes MUST be mounted BEFORE express.json()
// because we need the raw body for HMAC signature verification.
app.use('/webhooks', express.json({
  verify: (req, _res, buf) => {
    // Store raw body for HMAC verification
    req.rawBody = buf.toString('utf8');
  }
}), (req, res, next) => {
  // Verify HMAC signature on all webhook requests
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!verifyWebhookHmac(req.rawBody, hmac)) {
    console.error('❌ Webhook HMAC verification failed');
    return res.status(401).send('Unauthorized');
  }
  next();
}, webhooksRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Serve public static files (privacy policy, etc.)
app.use(express.static('public'));

// Privacy policy route (required for App Store listing)
app.get('/privacy', (req, res) => {
  res.sendFile('privacy.html', { root: 'public' });
});

// Public app config for frontend initialization
app.get('/api/config', (req, res) => {
  res.json({
    apiKey: process.env.SHOPIFY_API_KEY || '',
  });
});

// Root route - Redirect to frontend or show re-auth
app.get('/', async (req, res) => {
  const shop = req.query.shop || '';
  const host = req.query.host;

  if (shop) {
    // Try to find an existing session for this shop
    const existingSession = await findSessionByShop(String(shop));
    const sessionValid = existingSession && validateSession(ensureSessionInstance(existingSession));

    if (!sessionValid || !sessionValid?.valid) {
      const authUrl = new URL('/auth', `${req.protocol}://${req.get('host')}`);
      authUrl.searchParams.set('shop', String(shop));
      authUrl.searchParams.set('embedded', '1');
      return res.redirect(authUrl.toString());
    }
  }

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

    const authResponse = await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });

    // In Node adapter, auth.begin writes redirect headers/body directly.
    if (res.headersSent) {
      return;
    }

    // Fallback for adapters that may return a redirect URL instead.
    if (typeof authResponse === 'string') {
      return res.redirect(authResponse);
    }

    const locationHeader =
      authResponse?.headers?.Location ||
      authResponse?.headers?.location;
    if (locationHeader) {
      return res.redirect(locationHeader);
    }

    return res.status(500).send('Failed to begin OAuth flow.');
  } catch (error) {
    console.error('Auth error:', error);
    if (!res.headersSent) {
      res.status(500).send(error.message);
    }
  }
});

// Make shopify instance available to routes and utils
app.set('shopify', shopify);
global.shopifyInstance = shopify;

function startBackgroundSync(session, reason = 'startup') {
  if (!session) return;

  const shop = session.shop;
  const client = createGraphQLClient(session);

  console.log(`🔄 Starting background sync (${reason}) for ${shop}...`);

  // Sync settings first (fast)
  syncSettings(client, shop).catch((err) =>
    console.error(`⚠️  Background settings sync failed (${reason}):`, err.message)
  );

  // Sync products in parallel (may take longer on larger catalogs)
  syncAllProducts(client, shop).catch((err) =>
    console.error(`⚠️  Background product sync failed (${reason}):`, err.message)
  );
}

// Auth Callback
app.get('/auth/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;

    // Validate session
    const validation = validateSession(session);
    if (!validation.valid) {
      return res.status(401).send(
        `Session is missing required permissions (${validation.missingScopes.join(', ')}). Please reinstall or re-authenticate the app.`
      );
    }

    // Store session in database (multi-tenant)
    await storeSession(validation.session);
    console.log(`💾 Saved session to database for ${validation.session.shop}`);

    const host = req.query.host;
    if (!res.headersSent) {
      // Sync API URL to storefront metafields before redirecting
      const apiUrl = getPublicAppUrl();
      if (apiUrl) {
        const client = createGraphQLClient(validation.session);
        await syncApiUrlMetafield(client, apiUrl);
      }

      // Kick off initial DB sync right after successful install/auth.
      startBackgroundSync(validation.session, 'auth_callback');

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

// ============================================================
// App Proxy Signature Verification Middleware
// ============================================================

/**
 * Middleware for app proxy routes.
 * Verifies the signature when the request comes through Shopify's app proxy.
 * In development mode, allows unsigned requests for easier testing.
 */
function appProxyAuth(req, res, next) {
  // If it looks like an app proxy request (has signature param), verify it
  if (req.query.signature) {
    if (!verifyAppProxySignature(req.query)) {
      console.error('❌ App proxy signature verification failed');
      return res.status(401).json({ error: true, message: 'Invalid proxy signature' });
    }
  }
  next();
}

// API Routes — apply app proxy auth middleware
app.use('/api/recommendations', appProxyAuth, recommendationsRouter);
app.use('/api/products', productsRouter);
app.use('/api/settings', appProxyAuth, settingsRouter);
app.use('/api/sync', syncRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'));

  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'dist' });
  });
}

// Auto-run database migration on startup
async function runMigration() {
  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    const sql = await fs.readFile(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('✅ Database migration completed');
  } catch (error) {
    console.error('❌ Database migration failed:', error.message);
    console.error('   Make sure PostgreSQL is running and DATABASE_URL is set in .env');
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Auth URL: http://localhost:${PORT}/auth`);

  // Run DB migration
  await runMigration();

  // Try loading session from DB on start (for the dev store)
  try {
    const devStore = process.env.DEV_STORE_URL || '';
    if (devStore) {
      const session = await findSessionByShop(devStore);
      if (session) {
        const sessionInstance = ensureSessionInstance(session);
        const validation = validateSession(sessionInstance);
        if (validation.valid) {
          const authorized = await verifySessionAuthorization(validation.session);
          if (authorized) {
            console.log(`✅ Active session loaded from DB for: ${validation.session.shop}`);
            startBackgroundSync(validation.session, 'startup');
          } else {
            console.log('⚠️  Stored session is no longer authorized. Re-authentication needed.');
          }
        } else {
          console.log(`⚠️  Stored session is not valid (${validation.reason}). Re-authentication is required.`);
        }
      } else {
        console.log('⚠️  No active session found on startup. Products will sync after authentication.');
      }
    } else {
      console.log('ℹ️  No DEV_STORE_URL set. Sessions will be loaded per-request from the database.');
    }
  } catch (err) {
    console.error('❌ Failed to load session during startup:', err);
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Uncaught Server Error:', err);

  if (!res.headersSent) {
    const isProd = process.env.NODE_ENV === 'production';
    res.status(500).json({
      error: true,
      message: isProd ? 'An internal server error occurred' : err.message,
    });
  }
});

export default app;
