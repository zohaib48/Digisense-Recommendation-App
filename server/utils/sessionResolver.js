import { findSessionByShop } from '../db/sessionStore.js';
import { ensureSessionInstance, validateSession } from './sessionUtils.js';

/**
 * Resolve a valid Shopify session for a given shop.
 * Reads from the database (multi-tenant).
 * @param {string} [shop] — Optional shop domain hint. Falls back to DEV_STORE_URL.
 */
export async function resolveSessionValidation(shop) {
  const targetShop = shop || process.env.DEV_STORE_URL || '';

  if (!targetShop) {
    return { session: null, valid: false, reason: 'missing_shop', missingScopes: [] };
  }

  try {
    const rawSession = await findSessionByShop(targetShop);
    if (!rawSession) {
      return { session: null, valid: false, reason: 'missing_session', missingScopes: [] };
    }

    const session = ensureSessionInstance(rawSession);
    const validation = validateSession(session);
    return validation;
  } catch (error) {
    console.error('Failed to resolve session from database:', error.message);
    return { session: null, valid: false, reason: 'error', missingScopes: [] };
  }
}
