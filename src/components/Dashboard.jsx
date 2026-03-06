import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Button,
  TextField,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Form,
  FormLayout,
  ChoiceList,
  Checkbox,
  Spinner
} from '@shopify/polaris';

/**
 * Custom authenticated fetch hook.
 * Uses App Bridge CDN's shopify.idToken() to get a session token
 * and sends it as a Bearer token in the Authorization header.
 */
function useAppFetch() {
  return useCallback(async (url, options = {}) => {
    const headers = { ...options.headers };

    // Get session token from App Bridge CDN (if available)
    try {
      if (window.shopify && typeof window.shopify.idToken === 'function') {
        const token = await window.shopify.idToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }
    } catch (e) {
      console.warn('Could not get App Bridge session token:', e.message);
    }

    return fetch(url, { ...options, headers });
  }, []);
}

const VALID_SIZE_MATCH_STYLES = new Set(['exact', 'exact_or_similar', 'none']);
const DEFAULT_MAX_RECOMMENDATIONS = 8;

function normalizeRecommendationLimit(value, fallback = DEFAULT_MAX_RECOMMENDATIONS) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(24, parsed));
}

function Dashboard() {
  const fetch = useAppFetch();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [reauthContext, setReauthContext] = useState({ shop: '', host: '' });

  const [settings, setSettings] = useState({
    sizeMatchStyle: ['exact_or_similar'],
    priceRangePercentage: '20',
    filterByProductType: true,
    filterByCategoryTags: false,
    productPageMaxRecommendations: String(DEFAULT_MAX_RECOMMENDATIONS),
    cartMaxRecommendations: String(DEFAULT_MAX_RECOMMENDATIONS),
  });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/settings');
      if (response.status === 401) {
        const params = new URLSearchParams(window.location.search);
        const shop = params.get('shop');
        const host = params.get('host');

        if (shop) {
          setReauthContext({ shop, host: host || '' });
        }
        setReauthRequired(true);
        setLoading(false);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'Failed to load settings');
      }

      setReauthRequired(false);
      const data = await response.json();
      const s = data.settings || {};
      const normalizedSizeMatchStyle = VALID_SIZE_MATCH_STYLES.has(s.sizeMatchStyle)
        ? s.sizeMatchStyle
        : 'exact_or_similar';
      setSettings({
        sizeMatchStyle: [normalizedSizeMatchStyle],
        priceRangePercentage: String(s.priceRangePercentage || 20),
        filterByProductType: s.filterByProductType ?? true,
        filterByCategoryTags: s.filterByCategoryTags ?? false,
        productPageMaxRecommendations: String(
          normalizeRecommendationLimit(s.productPageMaxRecommendations, DEFAULT_MAX_RECOMMENDATIONS)
        ),
        cartMaxRecommendations: String(
          normalizeRecommendationLimit(s.cartMaxRecommendations, DEFAULT_MAX_RECOMMENDATIONS)
        ),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetch]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleReauthenticate = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const shop = reauthContext.shop || params.get('shop') || '';
    const host = reauthContext.host || params.get('host') || '';

    if (!shop) {
      setError('Missing shop parameter. Please re-open the app from Shopify Admin.');
      return;
    }

    const authParams = new URLSearchParams({ shop, embedded: '1' });
    if (host) {
      authParams.set('host', host);
    }
    const authUrl = `/auth?${authParams.toString()}`;

    try {
      if (window.top) {
        window.top.location.href = authUrl;
        return;
      }
    } catch (_error) {
      // Fallback to same-frame navigation when top is inaccessible.
    }

    window.location.assign(authUrl);
  }, [reauthContext]);

  const handleSaveSettings = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const selectedSizeStyle = settings.sizeMatchStyle[0];
      const payload = {
        sizeMatchStyle: VALID_SIZE_MATCH_STYLES.has(selectedSizeStyle) ? selectedSizeStyle : 'exact_or_similar',
        priceRangePercentage: Number.parseFloat(settings.priceRangePercentage) || 20,
        filterByProductType: settings.filterByProductType,
        filterByCategoryTags: settings.filterByCategoryTags,
        productPageMaxRecommendations: normalizeRecommendationLimit(settings.productPageMaxRecommendations),
        cartMaxRecommendations: normalizeRecommendationLimit(settings.cartMaxRecommendations),
      };

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload })
      });

      if (!response.ok) throw new Error('Failed to save settings');
      setSuccess('Settings saved successfully!');

      // Clear recommendations cache so new settings apply
      await fetch('/api/recommendations/cache', { method: 'DELETE' });

    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [fetch, settings]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spinner size="large" />
      </div>
    );
  }

  return (
    <Page
      title="Recommendation Settings"
      subtitle="Configure how products are recommended to your customers"
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {reauthRequired && (
          <Layout.Section>
            <Banner tone="warning">
              <p>Session expired after uninstall/reinstall. Click below to re-authenticate; product sync starts automatically after auth callback.</p>
              <div style={{ marginTop: '12px' }}>
                <Button primary onClick={handleReauthenticate}>
                  Re-authenticate & Sync
                </Button>
              </div>
            </Banner>
          </Layout.Section>
        )}

        {success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setSuccess(null)}>
              <p>{success}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Filtering Criteria
              </Text>
              <Text as="p" color="subdued">
                Adjust how the recommendation engine matches similar products for your store.
              </Text>

              <Divider />

              <Form onSubmit={handleSaveSettings}>
                <FormLayout>
                  <ChoiceList
                    title="Selected Size Match"
                    choices={[
                      {
                        label: 'Exact Match Only',
                        value: 'exact',
                        helpText: 'Only exact values match. Example: target "M" matches only "M".'
                      },
                      {
                        label: 'Exact or Similar',
                        value: 'exact_or_similar',
                        helpText: 'Exact plus partial/inclusive values. Example: "M" can match "M", "M/L", or "M (38-40)".'
                      },
                      {
                        label: 'No Size Filter',
                        value: 'none',
                        helpText: 'Ignore size completely. Example: recommend by price (and optional type/tags) even when sizes differ.'
                      },
                    ]}
                    selected={settings.sizeMatchStyle}
                    onChange={(val) => setSettings({ ...settings, sizeMatchStyle: val })}
                  />
                  <Text as="p" color="subdued">
                    Tip: use `No Size Filter` for one-size catalogs, products without size variants, or when price similarity matters more than size.
                  </Text>

                  <TextField
                    label="Price Range (± %)"
                    type="number"
                    value={settings.priceRangePercentage}
                    onChange={(val) => setSettings({ ...settings, priceRangePercentage: val })}
                    helpText="Target price range for recommended products compared to the current product/cart item."
                    min={0}
                    max={100}
                    suffix="%"
                  />

                  <TextField
                    label="Product Page Recommendations Count"
                    type="number"
                    value={settings.productPageMaxRecommendations}
                    onChange={(val) => setSettings({ ...settings, productPageMaxRecommendations: val })}
                    helpText='How many products to show on product page widget. Example: 4 = show up to 4 recommendations.'
                    min={1}
                    max={24}
                  />

                  <TextField
                    label="Cart Recommendations Count"
                    type="number"
                    value={settings.cartMaxRecommendations}
                    onChange={(val) => setSettings({ ...settings, cartMaxRecommendations: val })}
                    helpText='How many products to show in cart recommendations. Example: 8 = show up to 8 products.'
                    min={1}
                    max={24}
                  />

                  <Checkbox
                    label="Filter by Product Type"
                    helpText="Only recommend items that share same Product Type."
                    checked={settings.filterByProductType}
                    onChange={(val) => setSettings({ ...settings, filterByProductType: val })}
                  />

                  <Checkbox
                    label="Filter by Category/Tags"
                    helpText="Only recommend items that share the same product tags."
                    checked={settings.filterByCategoryTags}
                    onChange={(val) => setSettings({ ...settings, filterByCategoryTags: val })}
                  />

                  <InlineStack align="end">
                    <Button primary submit loading={saving}>
                      Save Settings
                    </Button>
                  </InlineStack>
                </FormLayout>
              </Form>

            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section secondary>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Need Help?
              </Text>
              <Text as="p" color="subdued">
                These settings are used to dynamically filter recommendations on the Product and Cart widgets.
              </Text>
              <Text as="p" color="subdued">
                Higher price range percentages usually result in more recommendations but may be less accurate.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default Dashboard;
