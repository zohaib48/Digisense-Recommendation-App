/**
 * Product Sync Engine
 *
 * Fetches all products from the Shopify GraphQL API and upserts them into
 * the local PostgreSQL database. This is intended to run:
 *   1. On server startup (if a valid session exists)
 *   2. On-demand via POST /api/sync/products
 *
 * After sync, storefront recommendation requests query the local DB
 * instead of hitting the Shopify API, resulting in ~100x faster responses.
 */
import {
    getProductsByFilters,
} from './productQueries.js';
import { getMerchantSettings } from './metafieldUtils.js';
import { upsertProducts, deleteStaleProducts, getProductCount } from '../db/productStore.js';
import { saveSettings } from '../db/settingsStore.js';

/**
 * Sync all products from Shopify → PostgreSQL.
 *
 * @param {GraphqlClient} client — Authenticated Shopify GraphQL client
 * @param {string} shop — Shop domain e.g. my-store.myshopify.com
 * @returns {Promise<Object>} Sync summary
 */
export async function syncAllProducts(client, shop) {
    const startTime = Date.now();
    const syncStartTimestamp = new Date();

    console.log(`\n🔄 Starting product sync for ${shop}...`);

    try {
        // Fetch ALL products from Shopify (paginated internally by productQueries)
        const configuredLimit = parseInt(process.env.PRODUCT_FETCH_LIMIT || '2000', 10);
        const allProducts = await getProductsByFilters(client, {
            limit: configuredLimit,
        });

        console.log(`   📦 Fetched ${allProducts.length} products from Shopify`);

        // Upsert in batches of 50 to avoid overwhelming the DB
        const BATCH_SIZE = 50;
        for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
            const batch = allProducts.slice(i, i + BATCH_SIZE);
            await upsertProducts(shop, batch);

            if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= allProducts.length) {
                console.log(`   💾 Synced ${Math.min(i + BATCH_SIZE, allProducts.length)}/${allProducts.length} products`);
            }
        }

        // Delete products that were removed from Shopify (not seen in this sync run)
        const deletedCount = await deleteStaleProducts(shop, syncStartTimestamp);
        if (deletedCount > 0) {
            console.log(`   🗑️  Removed ${deletedCount} stale products`);
        }

        const durationMs = Date.now() - startTime;
        const totalInDb = await getProductCount(shop);

        console.log(`✅ Product sync completed in ${durationMs}ms — ${totalInDb} products in DB\n`);

        return {
            synced: allProducts.length,
            deleted: deletedCount,
            totalInDb,
            durationMs,
        };
    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error(`❌ Product sync failed after ${durationMs}ms:`, error.message);
        throw error;
    }
}

/**
 * Sync merchant settings from Shopify Metafields → local DB.
 *
 * @param {GraphqlClient} client
 * @param {string} shop
 */
export async function syncSettings(client, shop) {
    try {
        console.log(`🔄 Syncing merchant settings for ${shop}...`);
        const settings = await getMerchantSettings(client);
        await saveSettings(shop, settings);
        console.log(`✅ Merchant settings synced to DB`);
        return settings;
    } catch (error) {
        console.error('❌ Settings sync failed:', error.message);
        // Non-fatal — the app will use defaults
        return null;
    }
}

export default {
    syncAllProducts,
    syncSettings,
};
