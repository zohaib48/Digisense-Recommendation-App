import React from 'react';
import {
  AppProvider,
  Page,
  Banner,
  Frame
} from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import Dashboard from './components/Dashboard';

function App() {
  // App Bridge CDN (loaded in index.html) auto-initializes for embedded apps.
  // We just provide the Polaris UI provider and render our Dashboard.
  return (
    <AppProvider i18n={{}}>
      <Frame>
        <Dashboard />
      </Frame>
    </AppProvider>
  );
}

export default App;
