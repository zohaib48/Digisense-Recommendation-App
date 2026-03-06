import express from 'express';
import NodeCache from 'node-cache';
import { filterRecommendations } from '../utils/recommendationEngine.js';
import { resolveSessionValidation } from '../utils/sessionResolver.js';
import { getProductById, getFilteredProducts } from '../db/productStore.js';
import { getSettings } from '../db/settingsStore.js';

const router = express.Router();

// Recommendation result cache — 5 minute TTL
const recCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const DEFAULT_MAX_RECOMMENDATIONS = parseInt(process.env.MAX_RECOMMENDATIONS, 10) || 8;

function toBoundedPositiveInteger(value, fallback, min = 1, max = 24) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function isAppProxyRequest(req) {
  return Boolean(
    req.query.path_prefix ||
    req.query.signature ||
    req.query.hmac ||
    req.query.shop
  );
}

function sendProxyFallback(res, meta = {}) {
  return res.status(200).json({
    recommendations: [],
    cached: false,
    proxyFallback: true,
    ...meta,
  });
}

function resolveShop(req, validation) {
  // For app proxy requests, the shop comes from the query string
  if (req.query.shop) {
    return req.query.shop;
  }
  // Otherwise use the session
  return validation?.session?.shop || null;
}

function sendSessionError(req, res, validation) {
  if (isAppProxyRequest(req)) {
    return sendProxyFallback(res, {
      message: 'Session unavailable for storefront proxy request.',
      reason: validation.reason,
      missingScopes: validation.missingScopes || [],
    });
  }

  if (validation.reason === 'missing_scopes') {
    return res.status(401).json({
      error: true,
      message: `Session is missing required scopes: ${validation.missingScopes.join(', ')}. Re-authenticate from Shopify Admin.`,
      missingScopes: validation.missingScopes,
    });
  }

  if (validation.reason === 'unauthorized') {
    return res.status(401).json({
      error: true,
      message: 'Stored session was revoked by Shopify. Re-open the app from Shopify Admin to re-authenticate.',
    });
  }

  return res.status(401).json({
    error: true,
    message: 'No active valid session. Please open the app in Shopify Admin to authenticate.',
  });
}

function resolveErrorStatus(error) {
  if (error.statusCode) {
    const parsed = Number.parseInt(error.statusCode, 10);
    return Number.isNaN(parsed) ? 500 : parsed;
  }

  if (error.response?.code) {
    const parsed = Number.parseInt(error.response.code, 10);
    return Number.isNaN(parsed) ? 500 : parsed;
  }

  const message = String(error.message || '').toLowerCase();
  if (message.includes('access denied') || message.includes('missing required scopes')) {
    return 403;
  }

  return 500;
}

function parseItemsFromQuery(rawItems) {
  if (typeof rawItems !== 'string' || rawItems.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawItems);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function buildCartRecommendations(shop, items, settings) {
  const allRecommendations = [];
  const processedProducts = new Set();
  const requiresSize = settings.sizeMatchStyle !== 'none';
  const cartMaxRecommendations = toBoundedPositiveInteger(
    settings.cartMaxRecommendations,
    DEFAULT_MAX_RECOMMENDATIONS
  );
  const perItemMaxRecommendations = Math.max(4, cartMaxRecommendations);

  for (const item of items) {
    const rawProductId = item.product_id ?? item.productId ?? item.id ?? item.product?.id;
    const normalizedProductId = rawProductId === null || rawProductId === undefined
      ? ''
      : String(rawProductId).trim();

    const size = item.properties?.Size || item.variant_title?.split('/')[0]?.trim();
    const price = parseFloat(item.price);

    if (!normalizedProductId || !Number.isFinite(price) || processedProducts.has(normalizedProductId)) {
      continue;
    }

    if (requiresSize && !size) {
      continue;
    }

    processedProducts.add(normalizedProductId);

    // Get product details from local DB
    const product = await getProductById(normalizedProductId, shop);
    if (!product) continue;

    // All cart product IDs to exclude
    const allCartProductIds = items.map(i => {
      const id = i.product_id ?? i.productId ?? i.id ?? i.product?.id;
      return id === null || id === undefined ? '' : String(id).trim();
    }).filter(Boolean);

    // Build filters for DB query
    const queryFilters = {
      excludeProductId: allCartProductIds
    };

    if (settings.filterByProductType) {
      queryFilters.productType = product.productType;
    }
    if (settings.filterByCategoryTags) {
      queryFilters.tags = product.tags;
    }

    // Query local DB instead of Shopify API
    const products = await getFilteredProducts(shop, queryFilters);

    const recs = filterRecommendations(products, {
      targetSize: size || '',
      targetPrice: price,
      priceRangePercentage: settings.priceRangePercentage,
      maxResults: perItemMaxRecommendations,
      currentProductId: normalizedProductId,
      sizeMatchStyle: settings.sizeMatchStyle
    });

    allRecommendations.push(...recs);
  }

  // Remove duplicates and sort by relevance score
  const uniqueRecommendations = Array.from(
    new Map(allRecommendations.map(item => [item.id, item])).values()
  ).sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, cartMaxRecommendations);

  return {
    recommendations: uniqueRecommendations,
    cartItemsProcessed: processedProducts.size
  };
}

/**
 * GET /api/recommendations/product/:productId
 * Get recommendations for a specific product based on size and price.
 * Now queries the LOCAL PostgreSQL database — zero Shopify API calls.
 */
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { size, price } = req.query;
    const normalizedPrice = Number.parseFloat(price);
    const normalizedSize = typeof size === 'string' ? size.trim() : '';

    if (Number.isNaN(normalizedPrice)) {
      if (isAppProxyRequest(req)) {
        return sendProxyFallback(res, {
          message: 'Invalid price input for product recommendations.',
          reason: 'invalid_query',
        });
      }
      return res.status(400).json({
        error: true,
        message: 'Valid price query parameter is required'
      });
    }

    // Check recommendation cache
    const cacheKey = `product_rec_${productId}_${normalizedSize}_${normalizedPrice}`;
    const cached = recCache.get(cacheKey);
    if (cached) {
      return res.json({ recommendations: cached.recommendations, cached: true, filters: cached.filters });
    }

    console.log(`📥 Recommendations Request: ${productId} | size: ${size} | price: ${price}`);

    // Resolve shop from session (we still need the session to know which shop we're serving)
    const validation = await resolveSessionValidation(req.query.shop);
    if (!validation.valid) {
      console.log(`❌ Request blocked: invalid session (${validation.reason})`);
      return sendSessionError(req, res, validation);
    }

    const shop = resolveShop(req, validation);

    // Fetch merchant settings from cache/DB (no Shopify API call)
    const settings = await getSettings(shop);
    const requiresSize = settings.sizeMatchStyle !== 'none';
    const productPageMaxRecommendations = toBoundedPositiveInteger(
      settings.productPageMaxRecommendations,
      DEFAULT_MAX_RECOMMENDATIONS
    );

    if (requiresSize && !normalizedSize) {
      if (isAppProxyRequest(req)) {
        return sendProxyFallback(res, {
          message: 'Size is required for the selected recommendation mode.',
          reason: 'missing_size',
        });
      }
      return res.status(400).json({
        error: true,
        message: 'Valid size query parameter is required for the current size filter mode'
      });
    }

    // Get current product from LOCAL DB (not Shopify API)
    console.log(`🔍 Looking up product in DB: ${productId}`);
    const currentProduct = await getProductById(productId, shop);

    if (!currentProduct) {
      console.log(`❌ Product ${productId} not found in DB`);
      if (isAppProxyRequest(req)) {
        return sendProxyFallback(res, {
          message: 'Product not found for recommendations.',
          reason: 'product_not_found',
        });
      }
      return res.status(404).json({
        error: true,
        message: 'Product not found'
      });
    }

    // Build filters for DB query
    const queryFilters = {
      excludeProductId: productId
    };
    if (settings.filterByProductType) {
      queryFilters.productType = currentProduct.productType;
    }
    if (settings.filterByCategoryTags) {
      queryFilters.tags = currentProduct.tags;
    }

    // Get filtered products from LOCAL DB (not Shopify API)
    const allProducts = await getFilteredProducts(shop, queryFilters);

    // Run the recommendation engine (same logic as before)
    const recommendations = filterRecommendations(allProducts, {
      targetSize: normalizedSize,
      targetPrice: normalizedPrice,
      priceRangePercentage: settings.priceRangePercentage,
      maxResults: productPageMaxRecommendations,
      currentProductId: productId,
      sizeMatchStyle: settings.sizeMatchStyle
    });

    // Cache the result
    const result = {
      recommendations,
      filters: {
        size: normalizedSize,
        price: normalizedPrice,
        productType: currentProduct.productType
      }
    };
    recCache.set(cacheKey, result);

    res.json({
      recommendations,
      cached: false,
      filters: result.filters
    });

  } catch (error) {
    console.error('CRITICAL Recommendation Error:', error);

    const statusCode = resolveErrorStatus(error);
    let errorMessage = 'An unexpected error occurred';
    if (statusCode === 401) {
      errorMessage = 'Session expired or unauthorized. Open the app in Shopify Admin to re-authenticate.';
    } else if (statusCode === 403) {
      errorMessage = 'Access denied by Shopify API. Re-authenticate the app to refresh scopes.';
    } else if (process.env.NODE_ENV === 'development') {
      errorMessage = error.message || errorMessage;
    }

    if (isAppProxyRequest(req)) {
      console.error('⚠️ Returning proxy-safe fallback for recommendations request');
      return sendProxyFallback(res, {
        message: errorMessage,
        statusCode,
      });
    }

    res.status(statusCode).json({
      error: true,
      message: errorMessage,
    });
  }

});

/**
 * GET /api/recommendations/cart
 * Get recommendations for items in cart using query param.
 */
router.get('/cart', async (req, res) => {
  try {
    const items = parseItemsFromQuery(req.query.items);

    if (!items || items.length === 0) {
      if (isAppProxyRequest(req)) {
        return sendProxyFallback(res, {
          message: 'Cart is empty or invalid for recommendations.',
          reason: 'invalid_cart',
        });
      }
      return res.status(400).json({
        error: true,
        message: 'Valid cart items query parameter is required'
      });
    }

    const validation = await resolveSessionValidation(req.query.shop);
    if (!validation.valid) {
      return sendSessionError(req, res, validation);
    }

    const shop = resolveShop(req, validation);
    const settings = await getSettings(shop);
    const result = await buildCartRecommendations(shop, items, settings);

    return res.json({
      recommendations: result.recommendations,
      cached: false,
      cartItemsProcessed: result.cartItemsProcessed
    });
  } catch (error) {
    console.error('Cart recommendation GET error:', error);
    const statusCode = resolveErrorStatus(error);
    if (isAppProxyRequest(req)) {
      return sendProxyFallback(res, {
        message: error.message || 'Failed to fetch cart recommendations',
        statusCode,
      });
    }
    return res.status(statusCode).json({
      error: true,
      message: error.message || 'Failed to fetch cart recommendations'
    });
  }
});

/**
 * POST /api/recommendations/cart
 * Get recommendations for items in cart.
 */
router.post('/cart', async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      if (isAppProxyRequest(req)) {
        return sendProxyFallback(res, {
          message: 'Cart is empty or invalid for recommendations.',
          reason: 'invalid_cart',
        });
      }
      return res.status(400).json({
        error: true,
        message: 'Cart items array is required'
      });
    }

    // Check cache
    const cacheKey = `cart_rec_${JSON.stringify(items.map(i => i.variant_id).sort())}`;
    const cached = recCache.get(cacheKey);
    if (cached) {
      return res.json({ recommendations: cached.recommendations, cached: true, cartItemsProcessed: cached.cartItemsProcessed });
    }

    const validation = await resolveSessionValidation(req.query.shop);
    if (!validation.valid) {
      return sendSessionError(req, res, validation);
    }

    const shop = resolveShop(req, validation);
    const settings = await getSettings(shop);
    const result = await buildCartRecommendations(shop, items, settings);

    // Cache it
    recCache.set(cacheKey, result);

    res.json({
      recommendations: result.recommendations,
      cached: false,
      cartItemsProcessed: result.cartItemsProcessed
    });

  } catch (error) {
    console.error('Cart recommendation error:', error);
    const statusCode = resolveErrorStatus(error);
    if (statusCode === 401) {
      return res.status(401).json({
        error: true,
        message: 'Session expired. Please re-authenticate.'
      });
    }
    if (statusCode === 403) {
      return res.status(403).json({
        error: true,
        message: 'Access denied by Shopify API. Re-authenticate the app to refresh scopes.',
      });
    }

    if (isAppProxyRequest(req)) {
      console.error('⚠️ Returning proxy-safe fallback for cart recommendations request');
      return sendProxyFallback(res, {
        message: error.message || 'Failed to fetch cart recommendations',
        statusCode,
      });
    }

    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

/**
 * GET /api/recommendations/similar/:productId
 * Get similar products based on tags and product type.
 */
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 6 } = req.query;

    const validation = await resolveSessionValidation(req.query.shop);
    if (!validation.valid) {
      return sendSessionError(req, res, validation);
    }

    const shop = resolveShop(req, validation);
    const product = await getProductById(productId, shop);

    if (!product) {
      if (isAppProxyRequest(req)) {
        return sendProxyFallback(res, {
          message: 'Product not found for similar recommendations.',
          reason: 'product_not_found',
        });
      }
      return res.status(404).json({
        error: true,
        message: 'Product not found'
      });
    }

    // Query DB for similar products
    const similar = await getFilteredProducts(shop, {
      tags: product.tags,
      productType: product.productType,
      excludeProductId: productId,
      limit: parseInt(limit)
    });

    res.json({
      similar,
      basedOn: {
        tags: product.tags,
        productType: product.productType
      }
    });

  } catch (error) {
    console.error('Similar products error:', error);
    if (isAppProxyRequest(req)) {
      return sendProxyFallback(res, {
        message: error.message || 'Failed to fetch similar products',
        statusCode: resolveErrorStatus(error),
      });
    }
    res.status(resolveErrorStatus(error)).json({
      error: true,
      message: error.message
    });
  }
});

/**
 * DELETE /api/recommendations/cache
 * Clear recommendation cache.
 */
router.delete('/cache', (req, res) => {
  try {
    recCache.flushAll();
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

export default router;
