/**
 * Session Store — PostgreSQL-backed session storage for multi-tenant support.
 *
 * Replaces the single JSON file approach to allow multiple merchants to use
 * the app simultaneously. Required for public Shopify apps.
 */
import { query } from './pool.js';

/**
 * Store (upsert) a session into the database.
 * @param {import('@shopify/shopify-api').Session} session
 */
export async function storeSession(session) {
    await query(
        `INSERT INTO sessions (id, shop, state, is_online, scope, access_token, expires_at, account_owner, collaborator, first_name, last_name, email, locale, email_verified, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
     ON CONFLICT (id) DO UPDATE SET
       shop = EXCLUDED.shop,
       state = EXCLUDED.state,
       is_online = EXCLUDED.is_online,
       scope = EXCLUDED.scope,
       access_token = EXCLUDED.access_token,
       expires_at = EXCLUDED.expires_at,
       account_owner = EXCLUDED.account_owner,
       collaborator = EXCLUDED.collaborator,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       email = EXCLUDED.email,
       locale = EXCLUDED.locale,
       email_verified = EXCLUDED.email_verified,
       updated_at = NOW()`,
        [
            session.id,
            session.shop,
            session.state || null,
            session.isOnline || false,
            typeof session.scope === 'string' ? session.scope : (session.scope || ''),
            session.accessToken || null,
            session.expires ? new Date(session.expires) : null,
            session.onlineAccessInfo?.associated_user?.account_owner || false,
            session.onlineAccessInfo?.associated_user?.collaborator || false,
            session.onlineAccessInfo?.associated_user?.first_name || null,
            session.onlineAccessInfo?.associated_user?.last_name || null,
            session.onlineAccessInfo?.associated_user?.email || null,
            session.onlineAccessInfo?.associated_user?.locale || null,
            session.onlineAccessInfo?.associated_user?.email_verified || false,
        ]
    );
    return true;
}

/**
 * Load a session from the database by session ID.
 * @param {string} sessionId
 * @returns {Object|undefined}
 */
export async function loadSession(sessionId) {
    const result = await query(
        'SELECT * FROM sessions WHERE id = $1',
        [sessionId]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    return {
        id: row.id,
        shop: row.shop,
        state: row.state,
        isOnline: row.is_online,
        scope: row.scope,
        accessToken: row.access_token,
        expires: row.expires_at ? new Date(row.expires_at) : undefined,
        onlineAccessInfo: row.first_name ? {
            associated_user: {
                account_owner: row.account_owner,
                collaborator: row.collaborator,
                first_name: row.first_name,
                last_name: row.last_name,
                email: row.email,
                locale: row.locale,
                email_verified: row.email_verified,
            }
        } : undefined,
    };
}

/**
 * Delete a session from the database.
 * @param {string} sessionId
 * @returns {boolean}
 */
export async function deleteSession(sessionId) {
    const result = await query(
        'DELETE FROM sessions WHERE id = $1',
        [sessionId]
    );
    return result.rowCount > 0;
}

/**
 * Delete all sessions for a given shop domain.
 * Used during app/uninstalled and shop/redact webhooks.
 * @param {string} shop
 * @returns {number} Number of deleted sessions
 */
export async function deleteSessionsByShop(shop) {
    const result = await query(
        'DELETE FROM sessions WHERE shop = $1',
        [shop]
    );
    return result.rowCount;
}

/**
 * Find an offline session for a given shop.
 * Offline sessions persist across merchant visits.
 * @param {string} shop
 * @returns {Object|undefined}
 */
export async function findSessionByShop(shop) {
    const result = await query(
        `SELECT * FROM sessions
     WHERE shop = $1 AND is_online = false AND access_token IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
        [shop]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    return {
        id: row.id,
        shop: row.shop,
        state: row.state,
        isOnline: row.is_online,
        scope: row.scope,
        accessToken: row.access_token,
        expires: row.expires_at ? new Date(row.expires_at) : undefined,
    };
}

export default {
    storeSession,
    loadSession,
    deleteSession,
    deleteSessionsByShop,
    findSessionByShop,
};
