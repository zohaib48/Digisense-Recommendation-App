-- Shopify Recommendations App — Database Schema
-- Safe to run multiple times (IF NOT EXISTS / OR REPLACE)

-- ============================================================
-- Products table
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,            -- Shopify GID e.g. gid://shopify/Product/123
  shop          TEXT NOT NULL,               -- e.g. my-store.myshopify.com
  title         TEXT NOT NULL DEFAULT '',
  handle        TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  product_type  TEXT NOT NULL DEFAULT '',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  vendor        TEXT NOT NULL DEFAULT '',
  images        JSONB NOT NULL DEFAULT '[]',
  price_min     NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_max     NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Variants table
-- ============================================================
CREATE TABLE IF NOT EXISTS variants (
  id                TEXT PRIMARY KEY,        -- Shopify GID e.g. gid://shopify/ProductVariant/456
  product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shop              TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  price             NUMERIC(12,2) NOT NULL DEFAULT 0,
  compare_at_price  NUMERIC(12,2),
  sku               TEXT NOT NULL DEFAULT '',
  available_for_sale BOOLEAN NOT NULL DEFAULT false,
  selected_options  JSONB NOT NULL DEFAULT '[]',
  image_url         TEXT
);

-- ============================================================
-- Merchant settings table
-- ============================================================
CREATE TABLE IF NOT EXISTS merchant_settings (
  shop        TEXT PRIMARY KEY,
  settings    JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes for fast recommendation queries
-- ============================================================

-- Products: filter by shop
CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop);

-- Products: filter by product_type within a shop
CREATE INDEX IF NOT EXISTS idx_products_shop_type ON products(shop, product_type);

-- Products: GIN index for tag-based filtering
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);

-- Products: price range queries
CREATE INDEX IF NOT EXISTS idx_products_price ON products(shop, price_min, price_max);

-- Variants: lookup by product
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);

-- Variants: filter by availability and price
CREATE INDEX IF NOT EXISTS idx_variants_available_price ON variants(shop, available_for_sale, price);

-- Variants: shop index
CREATE INDEX IF NOT EXISTS idx_variants_shop ON variants(shop);
