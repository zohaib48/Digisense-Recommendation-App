import { executeQuery } from './shopifyClient.js';

export const DEFAULT_SETTINGS = {
  sizeMatchStyle: 'exact_or_similar', // 'exact', 'exact_or_similar', or 'none'
  priceRangePercentage: 20,
  filterByProductType: true,
  filterByCategoryTags: false,
  productPageMaxRecommendations: 8,
  cartMaxRecommendations: 8,
};

export async function getMerchantSettings(client) {
  try {
    const shopQuery = `
      query {
        shop {
          metafield(namespace: "recommendations_app", key: "filters") {
            value
          }
        }
      }
    `;
    const data = await executeQuery(client, shopQuery);
    const metafield = data?.shop?.metafield;

    if (metafield && metafield.value) {
      const parsedSettings = JSON.parse(metafield.value);
      return { ...DEFAULT_SETTINGS, ...parsedSettings };
    }
  } catch (error) {
    console.error('❌ Failed to get merchant settings metafield:', error.message);
  }
  return DEFAULT_SETTINGS;
}

export async function setMerchantSettings(client, settings) {
  try {
    const shopQuery = `
      query {
        shop {
          id
        }
      }
    `;
    const shopData = await executeQuery(client, shopQuery);
    const shopId = shopData.shop.id;

    const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };

    const metafieldMutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      metafields: [
        {
          ownerId: shopId,
          namespace: 'recommendations_app',
          key: 'filters',
          value: JSON.stringify(mergedSettings),
          type: 'json'
        }
      ]
    };

    const result = await executeQuery(client, metafieldMutation, variables);

    if (result.metafieldsSet.userErrors && result.metafieldsSet.userErrors.length > 0) {
      console.error('❌ Metafield set user errors:', result.metafieldsSet.userErrors);
      return false;
    } else {
      console.log('✅ Merchant settings metafield updated successfully');
      return true;
    }
  } catch (error) {
    console.error('❌ Failed to set merchant settings metafield:', error.message);
    return false;
  }
}

/**
 * Sync the API URL metafield to the shop record
 * This allows storefront blocks to know where to fetch recommendations from
 * @param {GraphqlClient} client - Shopify GraphQL client
 * @param {string} apiUrl - The current tunnel URL (e.g., https://xyz.loca.lt)
 */
export async function syncApiUrlMetafield(client, apiUrl) {
  try {
    console.log(`🔄 Syncing API URL metafield: ${apiUrl}`);

    // 1. Get Shop ID
    const shopQuery = `
      query {
        shop {
          id
        }
      }
    `;
    const shopData = await executeQuery(client, shopQuery);
    const shopId = shopData.shop.id;

    // 2. Set Metafield
    const metafieldMutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      metafields: [
        {
          ownerId: shopId,
          namespace: 'recommendations_app',
          key: 'api_url',
          value: apiUrl,
          type: 'single_line_text_field'
        }
      ]
    };

    const result = await executeQuery(client, metafieldMutation, variables);

    if (result.metafieldsSet.userErrors && result.metafieldsSet.userErrors.length > 0) {
      console.error('❌ Metafield set user errors:', result.metafieldsSet.userErrors);
      return false; // Sync failed due to user errors
    } else {
      console.log('✅ API URL metafield updated successfully');
      return true; // Sync successful
    }
  } catch (error) {
    if (error.response && error.response.code === 401) {
      console.log('⚠️  Session expired — metafield sync skipped. Please re-authenticate by opening the app in Shopify Admin.');
      return false; // Sync failed due to auth
    } else {
      console.error('❌ Failed to sync API URL metafield:', error.message);
      return false; // Sync failed
    }
    // Don't throw here, as we don't want to break the app start if this fails
  }
}
