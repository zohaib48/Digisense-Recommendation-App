import { executeQuery } from './shopifyClient.js';

function toShopifyProductGid(productId) {
  if (productId === null || productId === undefined) return null;

  const raw = String(productId).trim();
  if (!raw) return null;

  if (raw.startsWith('gid://')) {
    return raw;
  }

  return `gid://shopify/Product/${raw}`;
}

/**
 * GraphQL query to get product details
 */
const PRODUCT_QUERY = `
  query getProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      description
      productType
      tags
      vendor
      images(first: 5) {
        edges {
          node {
            id
            url
            altText
          }
        }
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            compareAtPrice
            sku
            availableForSale
            selectedOptions {
              name
              value
            }
            image {
              url
            }
          }
        }
      }
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
        maxVariantPrice {
          amount
          currencyCode
        }
      }
    }
  }
`;

/**
 * GraphQL query to get multiple products with filters
 */
const PRODUCTS_QUERY = `
  query getProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          description
          productType
          tags
          vendor
          images(first: 3) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                sku
                availableForSale
                selectedOptions {
                  name
                  value
                }
                image {
                  url
                }
              }
            }
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

/**
 * Get detailed information about a specific product
 * @param {GraphqlClient} client - GraphQL client
 * @param {string} productId - Product ID
 * @returns {Promise<Object|null>} Product details
 */
export async function getProductDetails(client, productId) {
  try {
    // Ensure productId has proper format regardless of numeric/string input
    const id = toShopifyProductGid(productId);
    if (!id) {
      return null;
    }

    const data = await executeQuery(client, PRODUCT_QUERY, { id });

    if (!data.product) {
      return null;
    }

    return formatProduct(data.product);
  } catch (error) {
    console.error('Error fetching product details:', error);
    throw error;
  }
}

/**
 * Get products based on various filters
 * @param {GraphqlClient} client - GraphQL client
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} Array of products
 */
export async function getProductsByFilters(client, filters = {}) {
  try {
    const {
      productType,
      tags,
      excludeProductId,
      limit = 50
    } = filters;

    // Build query string
    let queryParts = [];

    if (productType) {
      const escapedType = productType.replace(/'/g, "\\'");
      queryParts.push(`product_type:'${escapedType}'`);
    }

    if (tags && tags.length > 0) {
      const tagQuery = tags.map(tag => `tag:'${tag.replace(/'/g, "\\'")}'`).join(' OR ');
      queryParts.push(`(${tagQuery})`);
    }

    const queryString = queryParts.length > 0 ? queryParts.join(' AND ') : '';

    const data = await executeQuery(client, PRODUCTS_QUERY, {
      first: limit,
      query: queryString || undefined
    });

    let products = data.products.edges.map(edge => formatProduct(edge.node));

    // Filter out excluded products
    if (excludeProductId) {
      const excludeIds = (Array.isArray(excludeProductId) ? excludeProductId : [excludeProductId])
        .map(id => toShopifyProductGid(id))
        .filter(Boolean);

      if (excludeIds.length > 0) {
        products = products.filter(p => !excludeIds.includes(p.id));
      }
    }

    return products;
  } catch (error) {
    console.error('Error fetching products:', error);
    throw error;
  }
}

/**
 * Search products by query
 * @param {GraphqlClient} client - GraphQL client
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} Array of products
 */
export async function searchProducts(client, query, limit = 20) {
  try {
    const data = await executeQuery(client, PRODUCTS_QUERY, {
      first: limit,
      query: `title:*${query}* OR tag:${query} OR product_type:${query}`
    });

    return data.products.edges.map(edge => formatProduct(edge.node));
  } catch (error) {
    console.error('Error searching products:', error);
    throw error;
  }
}

/**
 * Get all variants for a product
 * @param {GraphqlClient} client - GraphQL client
 * @param {string} productId - Product ID
 * @returns {Promise<Array>} Array of variants
 */
export async function getProductVariants(client, productId) {
  try {
    const product = await getProductDetails(client, productId);
    return product ? product.variants : [];
  } catch (error) {
    console.error('Error fetching product variants:', error);
    throw error;
  }
}

/**
 * Format product data for consistent structure
 * @param {Object} product - Raw product data from GraphQL
 * @returns {Object} Formatted product
 */
function formatProduct(product) {
  if (!product) return null;

  const variants = (product.variants?.edges || []).map(edge => ({
    id: edge.node?.id,
    title: edge.node?.title || '',
    price: parseFloat(edge.node?.price || 0),
    compareAtPrice: edge.node?.compareAtPrice
      ? parseFloat(edge.node.compareAtPrice)
      : null,
    sku: edge.node?.sku || '',
    availableForSale: !!edge.node?.availableForSale,
    selectedOptions: edge.node?.selectedOptions || [],
    image: edge.node?.image
  }));

  const variantPrices = variants
    .map(variant => variant.price)
    .filter(price => Number.isFinite(price) && price >= 0);

  const fallbackMin = parseFloat(product.priceRange?.minVariantPrice?.amount || 0);
  const fallbackMax = parseFloat(product.priceRange?.maxVariantPrice?.amount || 0);

  const normalizedPriceRange = variantPrices.length > 0
    ? {
      min: Math.min(...variantPrices),
      max: Math.max(...variantPrices),
      currencyCode: product.priceRange?.minVariantPrice?.currencyCode || 'USD'
    }
    : {
      min: fallbackMin,
      max: fallbackMax,
      currencyCode: product.priceRange?.minVariantPrice?.currencyCode || 'USD'
    };

  return {
    id: product.id,
    title: product.title || 'Untitled Product',
    handle: product.handle || '',
    description: product.description || '',
    productType: product.productType || '',
    tags: product.tags || [],
    vendor: product.vendor || '',
    images: (product.images?.edges || []).map(edge => ({
      id: edge.node?.id,
      url: edge.node?.url || '',
      altText: edge.node?.altText || ''
    })),
    variants,
    priceRange: normalizedPriceRange
  };
}

export default {
  getProductDetails,
  getProductsByFilters,
  searchProducts,
  getProductVariants,
};
