import express from 'express';
import { getProductById, getFilteredProducts } from '../db/productStore.js';
import { resolveSessionValidation } from '../utils/sessionResolver.js';

const router = express.Router();

function sendSessionError(res, validation) {
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

/**
 * GET /api/products/:productId
 * Get details of a specific product from the local DB.
 */
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(res, validation);
    }

    const shop = validation.session.shop;
    const product = await getProductById(productId, shop);

    if (!product) {
      return res.status(404).json({
        error: true,
        message: 'Product not found'
      });
    }

    res.json({ product });

  } catch (error) {
    console.error('Product fetch error:', error);
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

/**
 * GET /api/products
 * Get products with optional filters from the local DB.
 */
router.get('/', async (req, res) => {
  try {
    const { productType, tags, limit = 50 } = req.query;

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(res, validation);
    }

    const shop = validation.session.shop;
    const products = await getFilteredProducts(shop, {
      productType,
      tags: tags ? tags.split(',') : undefined,
      limit: parseInt(limit)
    });

    res.json({
      products,
      count: products.length
    });

  } catch (error) {
    console.error('Products fetch error:', error);
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

/**
 * POST /api/products/search
 * Search products by query in the local DB.
 * Uses ILIKE for simple text matching on title, product_type, and tags.
 */
router.post('/search', async (req, res) => {
  try {
    const { query: searchQuery, limit = 20 } = req.body;

    if (!searchQuery) {
      return res.status(400).json({
        error: true,
        message: 'Search query is required'
      });
    }

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(res, validation);
    }

    const shop = validation.session.shop;

    // For search, we use getFilteredProducts with no type/tag filter
    // and then filter client-side by title match.
    // A more advanced approach would add a full-text search index.
    const allProducts = await getFilteredProducts(shop, { limit: parseInt(limit) * 5 });
    const lowerQuery = searchQuery.toLowerCase();
    const products = allProducts
      .filter(p =>
        p.title.toLowerCase().includes(lowerQuery) ||
        p.productType.toLowerCase().includes(lowerQuery) ||
        p.tags.some(t => t.toLowerCase().includes(lowerQuery))
      )
      .slice(0, parseInt(limit));

    res.json({
      products,
      count: products.length,
      query: searchQuery
    });

  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

export default router;
