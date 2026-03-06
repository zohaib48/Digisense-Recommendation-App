/**
 * Shopify GraphQL Client with retry logic for rate limiting.
 *
 * @shopify/shopify-api v9+ — GraphqlClient requires the config from the
 * initialized shopify API instance. We use global.shopifyInstance which is set
 * during server startup.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a GraphQL client for Shopify API.
 * @param {Object} session - Shopify session object
 * @returns {GraphqlClient} GraphQL client instance
 */
export function createGraphQLClient(session) {
  const shopify = global.shopifyInstance;
  if (!shopify) {
    throw new Error('Shopify API not initialized. Ensure the server has started properly.');
  }

  const GraphqlClient = shopify.clients.Graphql;
  const client = new GraphqlClient({ session });

  return client;
}

/**
 * Execute a GraphQL query with automatic retry on rate limiting (429).
 * @param {GraphqlClient} client - GraphQL client instance
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Query results
 */
export async function executeQuery(client, query, variables = {}) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.query({
        data: {
          query,
          variables,
        },
      });

      if (response.body.errors) {
        const messages = response.body.errors
          .map((err) => err.message)
          .filter(Boolean)
          .join(' | ');
        const error = new Error(`GraphQL Errors: ${messages || JSON.stringify(response.body.errors)}`);
        error.graphQLErrors = response.body.errors;

        // Check if it's a throttle error
        const isThrottle = response.body.errors.some(
          e => e.extensions?.code === 'THROTTLED' || /throttl/i.test(e.message)
        );

        if (isThrottle && attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`⚠️  Shopify API throttled. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }

        if (/access denied|scope/i.test(messages)) {
          error.statusCode = 403;
          error.code = 'SHOPIFY_ACCESS_DENIED';
        }

        throw error;
      }

      return response.body.data;
    } catch (error) {
      lastError = error;

      // Handle HTTP 429 rate limiting
      if (error.code === 429 || error.response?.code === 429) {
        if (attempt < MAX_RETRIES - 1) {
          const retryAfter = parseInt(error.response?.headers?.['retry-after'] || '2', 10);
          const delay = retryAfter * 1000 * Math.pow(2, attempt);
          console.warn(`⚠️  Shopify API rate limited (429). Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }
      }

      // Handle 401 Unauthorized
      if (error.code === 401 || error.response?.code === 401) {
        error.statusCode = 401;
        if (!error.message?.includes('Session expired')) {
          error.message = 'Session expired or unauthorized. Please re-authenticate the app from Shopify Admin.';
        }
        throw error;
      }

      // Handle 403 Forbidden
      if (error.code === 403 || error.response?.code === 403) {
        error.statusCode = 403;
        throw error;
      }

      // For other errors, don't retry
      if (error.graphQLErrors) {
        throw error;
      }

      // Network errors — retry
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️  Shopify API network error. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`, error.message);
        await sleep(delay);
        continue;
      }

      console.error('GraphQL query error:', error);
      throw error;
    }
  }

  throw lastError;
}

export default {
  createGraphQLClient,
  executeQuery,
};
