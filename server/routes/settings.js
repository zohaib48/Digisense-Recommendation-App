import express from 'express';
import { createGraphQLClient } from '../utils/shopifyClient.js';
import { resolveSessionValidation } from '../utils/sessionResolver.js';
import { setMerchantSettings, DEFAULT_SETTINGS } from '../utils/metafieldUtils.js';
import { getSettings, saveSettings } from '../db/settingsStore.js';

const router = express.Router();

function isAppProxyRequest(req) {
    return Boolean(
        req.query.path_prefix ||
        req.query.signature ||
        req.query.hmac ||
        req.query.shop
    );
}

function sendSessionError(req, res, validation) {
    if (isAppProxyRequest(req)) {
        return res.status(200).json({
            settings: DEFAULT_SETTINGS,
            proxyFallback: true,
            message: 'Session unavailable for storefront proxy request.',
            reason: validation.reason,
        });
    }

    if (validation.reason === 'missing_scopes') {
        return res.status(401).json({
            error: true,
            message: `Session is missing required scopes. Re-authenticate from Shopify Admin.`,
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
 * GET /api/settings
 * Fetch the merchant's recommendation settings.
 * Reads from local DB cache (backed by in-memory cache) — no Shopify API call.
 */
router.get('/', async (req, res) => {
    try {
        const validation = await resolveSessionValidation();
        if (!validation.valid) {
            return sendSessionError(req, res, validation);
        }

        const shop = validation.session.shop;
        const settings = await getSettings(shop);

        res.json({ settings });
    } catch (error) {
        console.error('Error fetching settings:', error);
        if (isAppProxyRequest(req)) {
            return res.status(200).json({ settings: DEFAULT_SETTINGS, proxyFallback: true });
        }
        res.status(500).json({ error: true, message: 'Failed to fetch settings' });
    }
});

/**
 * POST /api/settings
 * Update the merchant's recommendation settings.
 * Writes to BOTH Shopify Metafield (source of truth) AND local DB (for fast reads).
 */
router.post('/', async (req, res) => {
    try {
        const { settings } = req.body;

        if (!settings) {
            return res.status(400).json({ error: true, message: 'Settings payload is required' });
        }

        const validation = await resolveSessionValidation();
        if (!validation.valid) {
            return sendSessionError(req, res, validation);
        }

        const shop = validation.session.shop;
        const client = createGraphQLClient(validation.session);

        // Write to Shopify Metafield (source of truth)
        const shopifySuccess = await setMerchantSettings(client, settings);

        if (shopifySuccess) {
            // Also write to local DB + invalidate cache for instant reads
            await saveSettings(shop, settings);
            res.json({ success: true, settings });
        } else {
            res.status(500).json({ error: true, message: 'Failed to update settings in Shopify' });
        }
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: true, message: 'Failed to update settings' });
    }
});

export default router;
