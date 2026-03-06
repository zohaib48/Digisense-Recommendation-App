/**
 * Shopify Webhook Handler Routes
 *
 * Handles product lifecycle webhooks for real-time database sync:
 *   - products/create  → Insert new product into DB
 *   - products/update  → Update existing product in DB
 *   - products/delete  → Remove product from DB
 *   - app/uninstalled  → Clean up all shop data
 *
 * GDPR Privacy Compliance webhooks:
 *   - customers/data_request  → Report customer data
 *   - customers/redact        → Delete customer data
 *   - shop/redact             → Delete all shop data
 *
 * All webhooks are verified via HMAC-SHA256 signature before processing.
 */
import express from 'express';
import crypto from 'crypto';
import { upsertProducts, deleteProductById } from '../db/productStore.js';
import { deleteSessionsByShop } from '../db/sessionStore.js';
import { query } from '../db/pool.js';

const router = express.Router();

/**
 * Verify Shopify webhook HMAC signature.
 * Shopify signs every webhook payload with your app's API secret.
 */
function verifyWebhookHmac(rawBody, hmacHeader) {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret || !hmacHeader) return false;

    const generatedHash = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');

    return crypto.timingSafeEqual(
        Buffer.from(generatedHash),
        Buffer.from(hmacHeader)
    );
}

/**
 * Transform a Shopify REST webhook product payload into the format
 * our DB expects (same shape as the GraphQL-based formatProduct).
 */
function transformWebhookProduct(shopifyProduct) {
    const variants = (shopifyProduct.variants || []).map(v => ({
        id: `gid://shopify/ProductVariant/${v.id}`,
        title: v.title || '',
        price: parseFloat(v.price) || 0,
        compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
        sku: v.sku || '',
        availableForSale: v.available !== false,
        selectedOptions: (v.option1 || v.option2 || v.option3)
            ? buildSelectedOptions(v, shopifyProduct.options || [])
            : [],
        image: v.image_id ? findVariantImage(v.image_id, shopifyProduct.images || []) : null,
    }));

    const variantPrices = variants.map(v => v.price).filter(p => Number.isFinite(p) && p >= 0);

    // Use the shop's currency from the webhook payload if available
    const currencyCode = shopifyProduct.currency
        || shopifyProduct.presentment_currencies?.[0]
        || '';

    return {
        id: `gid://shopify/Product/${shopifyProduct.id}`,
        title: shopifyProduct.title || 'Untitled Product',
        handle: shopifyProduct.handle || '',
        description: shopifyProduct.body_html || '',
        productType: shopifyProduct.product_type || '',
        tags: typeof shopifyProduct.tags === 'string'
            ? shopifyProduct.tags.split(',').map(t => t.trim()).filter(Boolean)
            : (shopifyProduct.tags || []),
        vendor: shopifyProduct.vendor || '',
        images: (shopifyProduct.images || []).slice(0, 5).map(img => ({
            id: `gid://shopify/ProductImage/${img.id}`,
            url: img.src || '',
            altText: img.alt || '',
        })),
        variants,
        priceRange: {
            min: variantPrices.length > 0 ? Math.min(...variantPrices) : 0,
            max: variantPrices.length > 0 ? Math.max(...variantPrices) : 0,
            currencyCode,
        },
    };
}

function buildSelectedOptions(variant, options) {
    const result = [];
    const optionValues = [variant.option1, variant.option2, variant.option3];

    for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const value = optionValues[i];
        if (value) {
            result.push({
                name: opt.name || `Option ${i + 1}`,
                value,
            });
        }
    }
    return result;
}

function findVariantImage(imageId, images) {
    const img = images.find(i => i.id === imageId);
    return img ? { url: img.src } : null;
}

// ============================================================
// Product Lifecycle Webhooks
// ============================================================

/**
 * POST /webhooks/products/create
 * Called when a merchant creates a new product.
 */
router.post('/products/create', async (req, res) => {
    const shop = req.headers['x-shopify-shop-domain'];
    const topic = req.headers['x-shopify-topic'];

    console.log(`📦 Webhook received: ${topic} from ${shop}`);

    try {
        const product = transformWebhookProduct(req.body);
        await upsertProducts(shop, [product]);
        console.log(`✅ Product created in DB: ${product.title} (${product.id})`);
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook products/create failed:', error.message);
        // Always return 200 to Shopify so it doesn't retry indefinitely
        res.status(200).send('Error logged');
    }
});

/**
 * POST /webhooks/products/update
 * Called when a merchant updates a product (title, price, variants, etc.)
 */
router.post('/products/update', async (req, res) => {
    const shop = req.headers['x-shopify-shop-domain'];
    const topic = req.headers['x-shopify-topic'];

    console.log(`📦 Webhook received: ${topic} from ${shop}`);

    try {
        const product = transformWebhookProduct(req.body);
        await upsertProducts(shop, [product]);
        console.log(`✅ Product updated in DB: ${product.title} (${product.id})`);
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook products/update failed:', error.message);
        res.status(200).send('Error logged');
    }
});

/**
 * POST /webhooks/products/delete
 * Called when a merchant deletes a product.
 * The payload only contains { id: ... } for delete events.
 */
router.post('/products/delete', async (req, res) => {
    const shop = req.headers['x-shopify-shop-domain'];
    const topic = req.headers['x-shopify-topic'];

    console.log(`📦 Webhook received: ${topic} from ${shop}`);

    try {
        const productId = req.body.id;
        const gid = `gid://shopify/Product/${productId}`;
        await deleteProductById(gid);
        console.log(`✅ Product deleted from DB: ${gid}`);
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook products/delete failed:', error.message);
        res.status(200).send('Error logged');
    }
});

// ============================================================
// App Lifecycle Webhooks
// ============================================================

/**
 * POST /webhooks/app/uninstalled
 * Called when a merchant uninstalls the app.
 * Cleans up all data for this shop (sessions, products, settings).
 */
router.post('/app/uninstalled', async (req, res) => {
    const shop = req.headers['x-shopify-shop-domain'];
    console.log(`🗑️  Webhook received: app/uninstalled from ${shop}`);

    try {
        // Delete sessions
        const sessionsDeleted = await deleteSessionsByShop(shop);
        console.log(`   Deleted ${sessionsDeleted} session(s) for ${shop}`);

        // Delete products and variants (CASCADE handles variants)
        await query('DELETE FROM products WHERE shop = $1', [shop]);
        console.log(`   Deleted products for ${shop}`);

        // Delete settings
        await query('DELETE FROM merchant_settings WHERE shop = $1', [shop]);
        console.log(`   Deleted settings for ${shop}`);

        console.log(`✅ All data cleaned up for uninstalled shop: ${shop}`);
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook app/uninstalled failed:', error.message);
        res.status(200).send('Error logged');
    }
});

// ============================================================
// GDPR Privacy Compliance Webhooks (mandatory for App Store)
// ============================================================

/**
 * POST /webhooks/privacy/customers-data-request
 * Shopify sends this when a customer requests their data.
 * Since this app does NOT store any customer personal data
 * (only product catalog data), we acknowledge and return 200.
 */
router.post('/privacy/customers-data-request', async (req, res) => {
    const shop = req.headers['x-shopify-shop-domain'];
    const { customer, data_request } = req.body;

    console.log(`📋 GDPR customers/data_request from ${shop} for customer ${customer?.id || 'unknown'}`);
    console.log(`   Orders requested: ${(req.body.orders_requested || []).length}`);

    // This app does not store personal customer data (PII).
    // We only store product catalog data and merchant settings.
    // Acknowledge the request — no data to export.
    console.log(`✅ GDPR data request acknowledged — no customer PII stored by this app`);
    res.status(200).send('OK');
});

/**
 * POST /webhooks/privacy/customers-redact
 * Shopify sends this when a customer requests erasure of their data.
 * Since this app does NOT store customer data, we acknowledge and return 200.
 */
router.post('/privacy/customers-redact', async (req, res) => {
    const shop = req.headers['x-shopify-shop-domain'];
    const { customer } = req.body;

    console.log(`🗑️  GDPR customers/redact from ${shop} for customer ${customer?.id || 'unknown'}`);

    // This app does not store personal customer data.
    // Acknowledge the erasure request — nothing to delete.
    console.log(`✅ GDPR customer redact acknowledged — no customer PII stored by this app`);
    res.status(200).send('OK');
});

/**
 * POST /webhooks/privacy/shop-redact
 * Shopify sends this 48 hours after a shop uninstalls the app.
 * We must delete ALL data associated with this shop.
 */
router.post('/privacy/shop-redact', async (req, res) => {
    const shop = req.headers['x-shopify-shop-domain'] || req.body.shop_domain;

    console.log(`🗑️  GDPR shop/redact received for ${shop}`);

    try {
        // Delete all sessions for this shop
        await deleteSessionsByShop(shop);

        // Delete all products (CASCADE removes variants)
        await query('DELETE FROM products WHERE shop = $1', [shop]);

        // Delete merchant settings
        await query('DELETE FROM merchant_settings WHERE shop = $1', [shop]);

        console.log(`✅ GDPR shop/redact completed — all data deleted for ${shop}`);
        res.status(200).send('OK');
    } catch (error) {
        console.error(`❌ GDPR shop/redact error for ${shop}:`, error.message);
        // Always return 200 — Shopify expects acknowledgment
        res.status(200).send('Error logged');
    }
});

export { verifyWebhookHmac };
export default router;
