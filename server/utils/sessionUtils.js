import { Session } from '@shopify/shopify-api';

function normalizeScopes(scopes = '') {
  if (Array.isArray(scopes)) {
    return scopes.map((scope) => scope.trim()).filter(Boolean);
  }

  return String(scopes)
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function getRequiredScopes() {
  return normalizeScopes(process.env.SCOPES || '');
}

function isScopeSatisfied(requiredScope, grantedScopesSet) {
  if (grantedScopesSet.has(requiredScope)) {
    return true;
  }

  // Shopify scope hierarchy: write_* implies read_* for the same resource.
  if (requiredScope.startsWith('read_')) {
    const resource = requiredScope.slice('read_'.length);
    if (resource && grantedScopesSet.has(`write_${resource}`)) {
      return true;
    }
  }

  return false;
}

export function getMissingScopes(grantedScopes = '', requiredScopes = getRequiredScopes()) {
  const granted = new Set(normalizeScopes(grantedScopes));
  return requiredScopes.filter((scope) => !isScopeSatisfied(scope, granted));
}

export function ensureSessionInstance(rawSession) {
  if (!rawSession) {
    return null;
  }

  if (rawSession instanceof Session) {
    return rawSession;
  }

  try {
    return new Session(rawSession);
  } catch (error) {
    console.error('Failed to reconstruct Shopify session:', error.message);
    return null;
  }
}

export function validateSession(rawSession) {
  const session = ensureSessionInstance(rawSession);
  if (!session) {
    return { session: null, valid: false, reason: 'missing_session', missingScopes: [] };
  }

  const requiredScopes = getRequiredScopes();
  const missingScopes = getMissingScopes(session.scope || '', requiredScopes);

  if (missingScopes.length > 0) {
    return {
      session,
      valid: false,
      reason: 'missing_scopes',
      missingScopes,
    };
  }

  if (!session.accessToken) {
    return {
      session,
      valid: false,
      reason: 'missing_access_token',
      missingScopes: [],
    };
  }

  if (typeof session.isExpired === 'function' && session.isExpired()) {
    return {
      session,
      valid: false,
      reason: 'expired',
      missingScopes: [],
    };
  }

  return { session, valid: true, reason: null, missingScopes: [] };
}
