/**
 * Sync Routes — Trigger product sync and check status.
 */
import express from 'express';
import { createGraphQLClient } from '../utils/shopifyClient.js';
import { resolveSessionValidation } from '../utils/sessionResolver.js';
import { syncAllProducts, syncSettings } from '../utils/syncProducts.js';
import { getProductCount, getLastSyncTime } from '../db/productStore.js';

const router = express.Router();

// Track sync state to prevent concurrent syncs
let isSyncing = false;
let lastSyncResult = null;

function sendSessionError(res, validation) {
    if (validation.reason === 'missing_scopes') {
        return res.status(401).json({
            error: true,
            message: `Session is missing required scopes: ${validation.missingScopes.join(', ')}. Re-authenticate from Shopify Admin.`,
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
 * POST /api/sync/products
 * Trigger a full product sync from Shopify → DB.
 */
router.post('/products', async (req, res) => {
    try {
        if (isSyncing) {
            return res.status(409).json({
                error: true,
                message: 'A sync is already in progress. Please wait.',
            });
        }

        const validation = await resolveSessionValidation(req.query.shop);
        if (!validation.valid) {
            return sendSessionError(res, validation);
        }

        const shop = validation.session.shop;
        const client = createGraphQLClient(validation.session);

        isSyncing = true;

        // Run sync
        const result = await syncAllProducts(client, shop);

        // Also sync settings
        await syncSettings(client, shop);

        lastSyncResult = {
            ...result,
            timestamp: new Date().toISOString(),
            shop,
        };

        isSyncing = false;

        res.json({
            success: true,
            ...lastSyncResult,
        });
    } catch (error) {
        isSyncing = false;
        console.error('Sync route error:', error);
        res.status(500).json({
            error: true,
            message: error.message || 'Sync failed',
        });
    }
});

/**
 * GET /api/sync/status
 * Returns the last sync result and current product count.
 */
router.get('/status', async (req, res) => {
    try {
        const validation = await resolveSessionValidation(req.query.shop);
        const shop = validation.valid ? validation.session.shop : null;

        let productCount = 0;
        let lastSync = null;

        if (shop) {
            productCount = await getProductCount(shop);
            lastSync = await getLastSyncTime(shop);
        }

        res.json({
            isSyncing,
            lastSyncResult,
            productCount,
            lastSync,
        });
    } catch (error) {
        res.status(500).json({
            error: true,
            message: error.message,
        });
    }
});

export { isSyncing };
export default router;
