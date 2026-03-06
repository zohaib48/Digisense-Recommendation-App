/**
 * Settings Store — PostgreSQL + in-memory cache for merchant settings.
 *
 * Settings are cached in memory for 15 minutes to avoid hitting the DB
 * on every single storefront request.
 */
import NodeCache from 'node-cache';
import { query } from './pool.js';
import { DEFAULT_SETTINGS } from '../utils/metafieldUtils.js';

// 15 minute TTL for settings cache
const settingsCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

/**
 * Get merchant settings — checks in-memory cache first, then DB, then defaults.
 * @param {string} shop — Shop domain
 * @returns {Promise<Object>} Merged settings
 */
export async function getSettings(shop) {
    // 1. Check in-memory cache
    const cacheKey = `settings_${shop}`;
    const cached = settingsCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // 2. Check database
    try {
        const result = await query(
            'SELECT settings FROM merchant_settings WHERE shop = $1',
            [shop]
        );

        if (result.rows.length > 0 && result.rows[0].settings) {
            const settings = { ...DEFAULT_SETTINGS, ...result.rows[0].settings };
            settingsCache.set(cacheKey, settings);
            return settings;
        }
    } catch (error) {
        console.error('❌ Failed to read settings from DB:', error.message);
    }

    // 3. Return defaults
    return DEFAULT_SETTINGS;
}

/**
 * Save merchant settings to the database and invalidate the cache.
 * @param {string} shop — Shop domain
 * @param {Object} settings — Settings object
 */
export async function saveSettings(shop, settings) {
    const merged = { ...DEFAULT_SETTINGS, ...settings };

    await query(
        `INSERT INTO merchant_settings (shop, settings, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (shop) DO UPDATE SET
       settings = EXCLUDED.settings,
       updated_at = NOW()`,
        [shop, JSON.stringify(merged)]
    );

    // Invalidate cache so the next read picks up the new value
    const cacheKey = `settings_${shop}`;
    settingsCache.set(cacheKey, merged);

    return merged;
}

/**
 * Invalidate the cached settings for a shop.
 */
export function invalidateSettingsCache(shop) {
    settingsCache.del(`settings_${shop}`);
}

/**
 * Pre-populate the settings cache from the database (used on startup).
 */
export async function warmSettingsCache(shop, settings) {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    settingsCache.set(`settings_${shop}`, merged);
    return merged;
}

export default {
    getSettings,
    saveSettings,
    invalidateSettingsCache,
    warmSettingsCache,
};
