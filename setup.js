#!/usr/bin/env node

import readline from 'readline';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function setup() {
  console.log('\n🚀 Shopify Recommendations App Setup\n');
  console.log('This script will help you configure your app.\n');

  try {
    // Check if .env exists
    const envExists = await fs.access('.env').then(() => true).catch(() => false);
    
    if (envExists) {
      const overwrite = await question('.env file already exists. Overwrite? (y/n): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('Setup cancelled.');
        rl.close();
        return;
      }
    }

    // Gather information
    console.log('\n📝 Please provide your Shopify app credentials:');
    console.log('(You can find these in your Shopify Partner Dashboard)\n');

    const apiKey = await question('Shopify API Key: ');
    const apiSecret = await question('Shopify API Secret: ');
    const devStore = await question('Development Store URL (e.g., mystore.myshopify.com): ');

    // Create .env file
    const envContent = `# Shopify App Configuration
SHOPIFY_API_KEY=${apiKey}
SHOPIFY_API_SECRET=${apiSecret}
SHOPIFY_HOST=will-be-auto-updated-by-launch-script
SCOPES=read_products,write_products,read_content,write_content

# Server Configuration
PORT=3000
NODE_ENV=development

# Recommendation Settings
PRICE_RANGE_PERCENTAGE=20
MAX_RECOMMENDATIONS=8
CACHE_TTL=300
`;

    await fs.writeFile('.env', envContent);
    console.log('\n✅ .env file created successfully!');

    // Update shopify.app.toml
    console.log('\n📝 Updating shopify.app.toml...');
    
    let tomlContent = await fs.readFile('shopify.app.toml', 'utf8');
    
    // Update client_id
    tomlContent = tomlContent.replace(
      /client_id = ".*"/,
      `client_id = "${apiKey}"`
    );
    
    // Update dev_store_url
    tomlContent = tomlContent.replace(
      /dev_store_url = ".*"/,
      `dev_store_url = "${devStore}"`
    );

    await fs.writeFile('shopify.app.toml', tomlContent);
    console.log('✅ shopify.app.toml updated successfully!');

    // Check dependencies
    console.log('\n📦 Checking dependencies...');
    const packageJsonExists = await fs.access('package.json').then(() => true).catch(() => false);
    
    if (!packageJsonExists) {
      console.log('❌ package.json not found!');
      rl.close();
      return;
    }

    const installDeps = await question('\nInstall dependencies? (y/n): ');
    
    if (installDeps.toLowerCase() === 'y') {
      console.log('\n📦 Installing dependencies...');
      try {
        await execAsync('npm install');
        console.log('✅ Dependencies installed successfully!');
      } catch (error) {
        console.log('⚠️  Error installing dependencies:', error.message);
      }
    }

    // Check for cloudflared
    console.log('\n🔍 Checking for Cloudflare Tunnel...');
    try {
      await execAsync('cloudflared --version');
      console.log('✅ Cloudflare Tunnel is installed!');
    } catch (error) {
      console.log('⚠️  Cloudflare Tunnel is not installed.');
      console.log('\n📥 To install cloudflared:');
      console.log('   macOS: brew install cloudflare/cloudflare/cloudflared');
      console.log('   Windows: Download from https://github.com/cloudflare/cloudflared/releases');
      console.log('   Linux: Visit https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/');
    }

    // Check for Shopify CLI
    console.log('\n🔍 Checking for Shopify CLI...');
    try {
      await execAsync('shopify version');
      console.log('✅ Shopify CLI is installed!');
    } catch (error) {
      console.log('⚠️  Shopify CLI is not installed.');
      console.log('\n📥 To install Shopify CLI:');
      console.log('   npm install -g @shopify/cli @shopify/app');
    }

    // Final instructions
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Setup Complete!');
    console.log('='.repeat(60));
    console.log('\n📋 Next Steps:\n');
    console.log('1. Make sure cloudflared and Shopify CLI are installed');
    console.log('2. Run: npm run launch');
    console.log('3. The app will start automatically!\n');
    console.log('📚 For more details, see README.md\n');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
  } finally {
    rl.close();
  }
}

setup();
