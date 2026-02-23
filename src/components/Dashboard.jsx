import React, { useState, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Button,
  TextField,
  Banner,
  DataTable,
  Badge,
  Text,
  BlockStack,
  InlineStack,
  Divider
} from '@shopify/polaris';

function Dashboard() {
  const [testProductId, setTestProductId] = useState('');
  const [testSize, setTestSize] = useState('');
  const [testPrice, setTestPrice] = useState('');
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleTestRecommendations = useCallback(async () => {
    if (!testProductId || !testSize || !testPrice) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/recommendations/product/${testProductId}?size=${testSize}&price=${testPrice}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data = await response.json();
      setRecommendations(data.recommendations || []);
      setSuccess(`Found ${data.recommendations?.length || 0} recommendations!`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [testProductId, testSize, testPrice]);

  const handleClearCache = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/recommendations/cache', {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to clear cache');
      }

      setSuccess('Cache cleared successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const rows = recommendations.map(rec => [
    rec.title,
    rec.matchingVariants?.length || 0,
    `$${rec.priceRange?.min.toFixed(2)} - $${rec.priceRange?.max.toFixed(2)}`,
    rec.relevanceScore,
    <Badge tone={rec.relevanceScore >= 80 ? 'success' : rec.relevanceScore >= 60 ? 'info' : 'warning'}>
      {rec.relevanceScore >= 80 ? 'Excellent' : rec.relevanceScore >= 60 ? 'Good' : 'Fair'}
    </Badge>,
    rec.reason || 'Similar product'
  ]);

  return (
    <Page
      title="Product Recommendations"
      subtitle="Configure and test your smart recommendation system"
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner status="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {success && (
          <Layout.Section>
            <Banner status="success" onDismiss={() => setSuccess(null)}>
              <p>{success}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                How It Works
              </Text>
              <Text as="p" color="subdued">
                This app automatically shows customers similar products based on:
              </Text>
              <ul style={{ marginLeft: '20px', color: 'var(--p-color-text-subdued)' }}>
                <li>Selected size (exact or similar)</li>
                <li>Price range (±20% by default)</li>
                <li>Product type and category</li>
              </ul>
              <Divider />
              <Text variant="headingMd" as="h2">
                Features
              </Text>
              <InlineStack gap="200">
                <Badge>Product Page Recommendations</Badge>
                <Badge>Cart Recommendations</Badge>
                <Badge>Smart Filtering</Badge>
                <Badge>Cached Results</Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Test Recommendations
              </Text>
              <Text as="p" color="subdued">
                Enter product details to test the recommendation engine
              </Text>

              <TextField
                label="Product ID"
                value={testProductId}
                onChange={setTestProductId}
                placeholder="e.g., 7234567890123 or gid://shopify/Product/7234567890123"
                helpText="Enter the numeric product ID or full GID"
              />

              <TextField
                label="Size"
                value={testSize}
                onChange={setTestSize}
                placeholder="e.g., M, Large, XL"
                helpText="Size to match against"
              />

              <TextField
                label="Price"
                value={testPrice}
                onChange={setTestPrice}
                type="number"
                placeholder="e.g., 29.99"
                prefix="$"
                helpText="Target price for recommendations"
              />

              <InlineStack gap="200">
                <Button
                  primary
                  onClick={handleTestRecommendations}
                  loading={loading}
                >
                  Get Recommendations
                </Button>
                <Button onClick={handleClearCache} loading={loading}>
                  Clear Cache
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {recommendations.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Recommendations ({recommendations.length})
                </Text>
                <DataTable
                  columnContentTypes={['text', 'numeric', 'text', 'numeric', 'text', 'text']}
                  headings={[
                    'Product',
                    'Variants',
                    'Price Range',
                    'Score',
                    'Match Quality',
                    'Reason'
                  ]}
                  rows={rows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section secondary>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Configuration
              </Text>
              <Text as="p" color="subdued">
                Customize recommendation behavior
              </Text>
              <Divider />
              <div>
                <Text as="p" fontWeight="semibold">Price Range: ±20%</Text>
                <Text as="p" color="subdued" variant="bodySm">
                  Products within this range will be shown
                </Text>
              </div>
              <div>
                <Text as="p" fontWeight="semibold">Max Results: 8</Text>
                <Text as="p" color="subdued" variant="bodySm">
                  Maximum recommendations to display
                </Text>
              </div>
              <div>
                <Text as="p" fontWeight="semibold">Cache TTL: 5 minutes</Text>
                <Text as="p" color="subdued" variant="bodySm">
                  Results cached for faster loading
                </Text>
              </div>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                API Endpoints
              </Text>
              <div>
                <Text as="p" fontWeight="semibold" variant="bodySm">
                  GET /api/recommendations/product/:id
                </Text>
                <Text as="p" color="subdued" variant="bodySm">
                  Get recommendations for a product
                </Text>
              </div>
              <div>
                <Text as="p" fontWeight="semibold" variant="bodySm">
                  POST /api/recommendations/cart
                </Text>
                <Text as="p" color="subdued" variant="bodySm">
                  Get recommendations for cart items
                </Text>
              </div>
              <div>
                <Text as="p" fontWeight="semibold" variant="bodySm">
                  GET /api/recommendations/similar/:id
                </Text>
                <Text as="p" color="subdued" variant="bodySm">
                  Get similar products by tags
                </Text>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default Dashboard;
