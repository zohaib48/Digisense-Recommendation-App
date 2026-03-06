/**
 * Product Store — PostgreSQL data access layer for products and variants.
 *
 * All recommendation queries go through here instead of the Shopify API,
 * making read operations ~100x faster.
 */
import { query, getClient } from './pool.js';

/**
 * Convert a raw numeric/string product ID to Shopify GID format.
 */
function toGid(productId) {
    if (!productId) return null;
    const raw = String(productId).trim();
    if (!raw) return null;
    if (raw.startsWith('gid://')) return raw;
    return `gid://shopify/Product/${raw}`;
}

// ============================================================
// READ operations
// ============================================================

/**
 * Get a single product with all its variants.
 * @param {string} productId — Raw ID or GID
 * @param {string} shop — Shop domain (optional, for multi-tenant safety)
 * @returns {Promise<Object|null>}
 */
export async function getProductById(productId, shop) {
    const gid = toGid(productId);
    if (!gid) return null;

    const params = shop ? [gid, shop] : [gid];
    const shopClause = shop ? ' AND p.shop = $2' : '';

    const productResult = await query(
        `SELECT p.*, json_agg(
       json_build_object(
         'id', v.id,
         'title', v.title,
         'price', v.price,
         'compareAtPrice', v.compare_at_price,
         'sku', v.sku,
         'availableForSale', v.available_for_sale,
         'selectedOptions', v.selected_options,
         'image', CASE WHEN v.image_url IS NOT NULL THEN json_build_object('url', v.image_url) ELSE NULL END
       ) ORDER BY v.price ASC
     ) AS variants_json
     FROM products p
     LEFT JOIN variants v ON v.product_id = p.id
     WHERE p.id = $1${shopClause}
     GROUP BY p.id`,
        params
    );

    if (productResult.rows.length === 0) return null;
    return formatProductRow(productResult.rows[0]);
}

/**
 * Get products filtered by type, tags, price, etc.
 * This replaces the old getProductsByFilters → Shopify GraphQL flow.
 *
 * @param {string} shop — Shop domain
 * @param {Object} filters
 * @param {string} [filters.productType]
 * @param {string[]} [filters.tags]
 * @param {string|string[]} [filters.excludeProductId]
 * @param {number} [filters.limit=500]
 * @returns {Promise<Array>}
 */
export async function getFilteredProducts(shop, filters = {}) {
    const {
        productType,
        tags,
        excludeProductId,
        limit = 500,
    } = filters;

    const conditions = ['p.shop = $1'];
    const params = [shop];
    let paramIndex = 2;

    if (productType) {
        conditions.push(`p.product_type = $${paramIndex}`);
        params.push(productType);
        paramIndex++;
    }

    if (tags && tags.length > 0) {
        // Match products that have ANY of the given tags (overlap operator &&)
        conditions.push(`p.tags && $${paramIndex}::text[]`);
        params.push(tags);
        paramIndex++;
    }

    // Exclude specific product IDs
    if (excludeProductId) {
        const excludeIds = (Array.isArray(excludeProductId) ? excludeProductId : [excludeProductId])
            .map(id => toGid(id))
            .filter(Boolean);

        if (excludeIds.length > 0) {
            conditions.push(`p.id != ALL($${paramIndex}::text[])`);
            params.push(excludeIds);
            paramIndex++;
        }
    }

    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    params.push(boundedLimit);

    const sql = `
    SELECT p.*, json_agg(
      json_build_object(
        'id', v.id,
        'title', v.title,
        'price', v.price,
        'compareAtPrice', v.compare_at_price,
        'sku', v.sku,
        'availableForSale', v.available_for_sale,
        'selectedOptions', v.selected_options,
        'image', CASE WHEN v.image_url IS NOT NULL THEN json_build_object('url', v.image_url) ELSE NULL END
      ) ORDER BY v.price ASC
    ) AS variants_json
    FROM products p
    LEFT JOIN variants v ON v.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id
    ORDER BY p.title ASC
    LIMIT $${paramIndex}
  `;

    const result = await query(sql, params);
    return result.rows.map(formatProductRow);
}

// ============================================================
// WRITE operations (used by sync engine)
// ============================================================

/**
 * Bulk upsert products and their variants into the database.
 * Uses a transaction to ensure consistency.
 *
 * @param {string} shop — Shop domain
 * @param {Array} products — Formatted product objects (same shape as from productQueries.js)
 */
export async function upsertProducts(shop, products) {
    if (!products || products.length === 0) return;

    const client = await getClient();
    try {
        await client.query('BEGIN');

        for (const product of products) {
            // Upsert product
            await client.query(
                `INSERT INTO products (id, shop, title, handle, description, product_type, tags, vendor, images, price_min, price_max, currency_code, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (id) DO UPDATE SET
           shop = EXCLUDED.shop,
           title = EXCLUDED.title,
           handle = EXCLUDED.handle,
           description = EXCLUDED.description,
           product_type = EXCLUDED.product_type,
           tags = EXCLUDED.tags,
           vendor = EXCLUDED.vendor,
           images = EXCLUDED.images,
           price_min = EXCLUDED.price_min,
           price_max = EXCLUDED.price_max,
           currency_code = EXCLUDED.currency_code,
           synced_at = NOW()`,
                [
                    product.id,
                    shop,
                    product.title || '',
                    product.handle || '',
                    product.description || '',
                    product.productType || '',
                    product.tags || [],
                    product.vendor || '',
                    JSON.stringify(product.images || []),
                    product.priceRange?.min ?? 0,
                    product.priceRange?.max ?? 0,
                    product.priceRange?.currencyCode || 'USD',
                ]
            );

            // Delete old variants for this product, then insert fresh ones
            await client.query('DELETE FROM variants WHERE product_id = $1', [product.id]);

            for (const variant of (product.variants || [])) {
                await client.query(
                    `INSERT INTO variants (id, product_id, shop, title, price, compare_at_price, sku, available_for_sale, selected_options, image_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [
                        variant.id,
                        product.id,
                        shop,
                        variant.title || '',
                        variant.price ?? 0,
                        variant.compareAtPrice ?? null,
                        variant.sku || '',
                        variant.availableForSale ?? false,
                        JSON.stringify(variant.selectedOptions || []),
                        variant.image?.url || null,
                    ]
                );
            }
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Remove products that were not refreshed in the latest sync.
 * This handles products deleted from Shopify.
 *
 * @param {string} shop
 * @param {Date} syncedBefore — Delete products with synced_at < this timestamp
 * @returns {Promise<number>} Number of deleted products
 */
export async function deleteStaleProducts(shop, syncedBefore) {
    const result = await query(
        'DELETE FROM products WHERE shop = $1 AND synced_at < $2',
        [shop, syncedBefore]
    );
    return result.rowCount;
}

/**
 * Delete a single product by its GID (used by webhooks).
 * CASCADE will automatically remove associated variants.
 *
 * @param {string} gid — Shopify Product GID
 * @returns {Promise<boolean>} True if a product was deleted
 */
export async function deleteProductById(gid) {
    const result = await query('DELETE FROM products WHERE id = $1', [gid]);
    return result.rowCount > 0;
}

/**
 * Get the count of products for a given shop.
 */
export async function getProductCount(shop) {
    const result = await query('SELECT COUNT(*) AS count FROM products WHERE shop = $1', [shop]);
    return parseInt(result.rows[0].count, 10);
}

/**
 * Get the last sync timestamp for a shop.
 */
export async function getLastSyncTime(shop) {
    const result = await query(
        'SELECT MAX(synced_at) AS last_sync FROM products WHERE shop = $1',
        [shop]
    );
    return result.rows[0]?.last_sync || null;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Transform a database row into the same product format the rest of the app expects.
 */
function formatProductRow(row) {
    // Parse variants — filter out null entries that come from LEFT JOIN with no variants
    let variants = [];
    if (Array.isArray(row.variants_json)) {
        variants = row.variants_json
            .filter(v => v && v.id !== null)
            .map(v => ({
                id: v.id,
                title: v.title || '',
                price: parseFloat(v.price) || 0,
                compareAtPrice: v.compareAtPrice != null ? parseFloat(v.compareAtPrice) : null,
                sku: v.sku || '',
                availableForSale: Boolean(v.availableForSale),
                selectedOptions: Array.isArray(v.selectedOptions) ? v.selectedOptions : (typeof v.selectedOptions === 'string' ? JSON.parse(v.selectedOptions) : []),
                image: v.image || null,
            }));
    }

    // Parse images
    let images = [];
    if (typeof row.images === 'string') {
        try { images = JSON.parse(row.images); } catch { images = []; }
    } else if (Array.isArray(row.images)) {
        images = row.images;
    }

    return {
        id: row.id,
        title: row.title || 'Untitled Product',
        handle: row.handle || '',
        description: row.description || '',
        productType: row.product_type || '',
        tags: row.tags || [],
        vendor: row.vendor || '',
        images,
        variants,
        priceRange: {
            min: parseFloat(row.price_min) || 0,
            max: parseFloat(row.price_max) || 0,
            currencyCode: row.currency_code || 'USD',
        },
    };
}

export default {
    getProductById,
    getFilteredProducts,
    upsertProducts,
    deleteStaleProducts,
    deleteProductById,
    getProductCount,
    getLastSyncTime,
};
