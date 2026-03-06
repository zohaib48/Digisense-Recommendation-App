/**
 * Create a GraphQL client for Shopify API
 * In @shopify/shopify-api v9+, GraphqlClient requires the config from the 
 * initialized shopify API instance. We use global.shopifyApi which is set 
 * during server startup.
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
 * Execute a GraphQL query
 * @param {GraphqlClient} client - GraphQL client instance
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Query results
 */
export async function executeQuery(client, query, variables = {}) {
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

      if (/access denied|scope/i.test(messages)) {
        error.statusCode = 403;
        error.code = 'SHOPIFY_ACCESS_DENIED';
      }

      throw error;
    }

    return response.body.data;
  } catch (error) {
    if (error.code === 401 || error.response?.code === 401) {
      error.statusCode = 401;
      if (!error.message?.includes('Session expired')) {
        error.message = 'Session expired or unauthorized. Please re-authenticate the app from Shopify Admin.';
      }
      // Mark current in-memory session as revoked so routes stop trusting it.
      global.activeSession = null;
      global.sessionRevoked = true;
    }

    if (error.code === 403 || error.response?.code === 403) {
      error.statusCode = 403;
    }
    console.error('GraphQL query error:', error);
    throw error;
  }
}

export default {
  createGraphQLClient,
  executeQuery,
};
