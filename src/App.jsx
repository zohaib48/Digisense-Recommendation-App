import React, { useState, useEffect } from 'react';
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Banner,
  Spinner,
  Frame
} from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import { Provider as AppBridgeProvider } from '@shopify/app-bridge-react';
import Dashboard from './components/Dashboard';

function App() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeApp() {
      try {
        // Get URL parameters
        const params = new URLSearchParams(window.location.search);
        const host = params.get('host');
        const shop = params.get('shop');

        if (!host || !shop) {
          throw new Error('Missing required parameters. Please install the app from your Shopify admin.');
        }

        let apiKey = import.meta.env.VITE_SHOPIFY_API_KEY;
        if (!apiKey) {
          const response = await fetch('/api/config');
          if (response.ok) {
            const data = await response.json();
            apiKey = data.apiKey;
          }
        }

        if (!apiKey) {
          throw new Error('Missing Shopify API key. Set VITE_SHOPIFY_API_KEY or ensure /api/config is available.');
        }

        const appConfig = {
          apiKey,
          host,
          forceRedirect: true
        };

        if (!cancelled) {
          setConfig(appConfig);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    initializeApp();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <Spinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <AppProvider i18n={{}}>
        <Frame>
          <Page title="Error">
            <Banner status="critical">
              <p>{error}</p>
            </Banner>
          </Page>
        </Frame>
      </AppProvider>
    );
  }

  return (
    <AppProvider i18n={{}}>
      <AppBridgeProvider config={config}>
        <Frame>
          <Dashboard />
        </Frame>
      </AppBridgeProvider>
    </AppProvider>
  );
}

export default App;
