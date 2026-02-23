import express from 'express';
import NodeCache from 'node-cache';
import { createGraphQLClient } from '../utils/shopifyClient.js';
import {
  getProductsByFilters,
  getProductDetails
} from '../utils/productQueries.js';
import { filterRecommendations } from '../utils/recommendationEngine.js';
import { resolveSessionValidation } from '../utils/sessionResolver.js';

const router = express.Router();
const cache = new NodeCache({ stdTTL: process.env.CACHE_TTL || 300 });

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

async function buildCartRecommendations(client, items) {
  // Aggregate recommendations from all cart items
  const allRecommendations = [];
  const processedProducts = new Set();

  for (const item of items) {
    const rawProductId = item.product_id ?? item.productId ?? item.id ?? item.product?.id;
    const normalizedProductId = rawProductId === null || rawProductId === undefined
      ? ''
      : String(rawProductId).trim();

    // Extract size and price from cart item
    const size = item.properties?.Size || item.variant_title?.split('/')[0]?.trim();
    const price = parseFloat(item.price);

    if (!normalizedProductId || !size || !price || processedProducts.has(normalizedProductId)) {
      continue;
    }

    processedProducts.add(normalizedProductId);

    // Get product details
    const product = await getProductDetails(client, normalizedProductId);
    if (!product) continue;

    // Pre-calculate all product IDs in the cart to exclude them
    const allCartProductIds = items.map(i => {
      const id = i.product_id ?? i.productId ?? i.id ?? i.product?.id;
      return id === null || id === undefined ? '' : String(id).trim();
    }).filter(Boolean);

    // Get recommendations for this item
    const products = await getProductsByFilters(client, {
      productType: product.productType,
      excludeProductId: allCartProductIds
    });

    const recs = filterRecommendations(products, {
      targetSize: size,
      targetPrice: price,
      priceRangePercentage: parseInt(process.env.PRICE_RANGE_PERCENTAGE) || 20,
      maxResults: 4,
      currentProductId: normalizedProductId
    });

    allRecommendations.push(...recs);
  }

  // Remove duplicates and sort by relevance score
  const uniqueRecommendations = Array.from(
    new Map(allRecommendations.map(item => [item.id, item])).values()
  ).sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, parseInt(process.env.MAX_RECOMMENDATIONS) || 8);

  return {
    recommendations: uniqueRecommendations,
    cartItemsProcessed: processedProducts.size
  };
}

/**
 * GET /api/recommendations/product/:productId
 * Get recommendations for a specific product based on size and price
 */
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { size, price } = req.query;
    const normalizedPrice = Number.parseFloat(price);

    // Validate required parameters
    if (!size || Number.isNaN(normalizedPrice)) {
      if (isAppProxyRequest(req)) {
        return sendProxyFallback(res, {
          message: 'Invalid size/price input for product recommendations.',
          reason: 'invalid_query',
        });
      }
      return res.status(400).json({
        error: true,
        message: 'Valid size and price query parameters are required'
      });
    }

    // Check cache
    // const cacheKey = `product_rec_${productId}_${size}_${price}`;
    // const cached = cache.get(cacheKey);
    // if (cached) {
    //   return res.json({ recommendations: cached, cached: true });
    // }

    console.log(`📥 Recommendations Request: ${productId} | size: ${size} | price: ${price}`);

    // Get Shopify session
    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      console.log(`❌ Request blocked: invalid session (${validation.reason})`);
      return sendSessionError(req, res, validation);
    }

    // Create GraphQL client
    const client = createGraphQLClient(validation.session);

    // Get current product details
    console.log(`🔍 Looking up product: ${productId}`);
    const currentProduct = await getProductDetails(client, productId);

    if (!currentProduct) {
      console.log(`❌ Product ${productId} not found in Shopify`);
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

    // Get all products from store
    const allProducts = await getProductsByFilters(client, {
      productType: currentProduct.productType,
      excludeProductId: productId
    });

    // Filter recommendations based on size and price
    const recommendations = filterRecommendations(allProducts, {
      targetSize: size,
      targetPrice: normalizedPrice,
      priceRangePercentage: parseInt(process.env.PRICE_RANGE_PERCENTAGE) || 20,
      maxResults: parseInt(process.env.MAX_RECOMMENDATIONS) || 8,
      currentProductId: productId
    });

    // Cache results
    // cache.set(cacheKey, recommendations);

    res.json({
      recommendations,
      cached: false,
      filters: {
        size,
        price: normalizedPrice,
        productType: currentProduct.productType
      }
    });

  } catch (error) {
    console.error('CRITICAL Recommendation Error:', error);

    // Log to file for later inspection
    try {
      import('fs').then(fs => {
        fs.promises.appendFile('API_CRASH.log', `[${new Date().toISOString()}] ${error.message}\n${error.stack}\n\n`);
      });
    } catch (e) { }

    const statusCode = resolveErrorStatus(error);
    let errorMessage = error.message || 'An unexpected error occurred';
    if (statusCode === 401) {
      errorMessage = 'Session expired or unauthorized. Open the app in Shopify Admin to re-authenticate.';
    } else if (statusCode === 403) {
      errorMessage = 'Access denied by Shopify API. Re-authenticate the app to refresh scopes.';
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
      details: error.response?.body || null,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/recommendations/cart
 * Get recommendations for items in cart using query param.
 * Expected: ?items=[{...}]
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

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(req, res, validation);
    }

    const client = createGraphQLClient(validation.session);
    const result = await buildCartRecommendations(client, items);

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
 * Get recommendations for items in cart
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
    // const cacheKey = `cart_rec_${JSON.stringify(items.map(i => i.variant_id).sort())}`;
    // const cached = cache.get(cacheKey);
    // if (cached) {
    //   return res.json({ recommendations: cached, cached: true });
    // }

    // Get Shopify session
    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(req, res, validation);
    }

    const client = createGraphQLClient(validation.session);
    const result = await buildCartRecommendations(client, items);

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
 * Get similar products (alternative approach using tags and collections)
 */
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 6 } = req.query;

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(req, res, validation);
    }

    const client = createGraphQLClient(validation.session);
    const product = await getProductDetails(client, productId);

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

    // Get products with matching tags
    const similar = await getProductsByFilters(client, {
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
 * Clear recommendation cache
 */
router.delete('/cache', (req, res) => {
  try {
    cache.flushAll();
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
