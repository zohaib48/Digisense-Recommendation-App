/**
 * Shopify Webhook Handler Routes
 *
 * Handles product lifecycle webhooks for real-time database sync:
 *   - products/create  → Insert new product into DB
 *   - products/update  → Update existing product in DB
 *   - products/delete  → Remove product from DB
 *
 * All webhooks are verified via HMAC-SHA256 signature before processing.
 */
import express from 'express';
import crypto from 'crypto';
import { upsertProducts, deleteProductById } from '../db/productStore.js';

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
            currencyCode: 'USD',
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

export { verifyWebhookHmac };
export default router;
