import express from 'express';
import { createGraphQLClient } from '../utils/shopifyClient.js';
import { 
  getProductDetails, 
  getProductsByFilters,
  searchProducts 
} from '../utils/productQueries.js';
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

  return res.status(401).json({
    error: true,
    message: 'No active valid session. Please open the app in Shopify Admin to authenticate.',
  });
}

/**
 * GET /api/products/:productId
 * Get details of a specific product
 */
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(res, validation);
    }

    const client = createGraphQLClient(validation.session);
    const product = await getProductDetails(client, productId);

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
 * Get products with optional filters
 */
router.get('/', async (req, res) => {
  try {
    const { productType, tags, limit = 50 } = req.query;

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(res, validation);
    }

    const client = createGraphQLClient(validation.session);
    const products = await getProductsByFilters(client, {
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
 * Search products by query
 */
router.post('/search', async (req, res) => {
  try {
    const { query, limit = 20 } = req.body;

    if (!query) {
      return res.status(400).json({
        error: true,
        message: 'Search query is required'
      });
    }

    const validation = await resolveSessionValidation();
    if (!validation.valid) {
      return sendSessionError(res, validation);
    }

    const client = createGraphQLClient(validation.session);
    const products = await searchProducts(client, query, parseInt(limit));

    res.json({
      products,
      count: products.length,
      query
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
