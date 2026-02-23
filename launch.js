import { spawn, execSync } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
    backendPort: 3000,
    frontendPort: 4000,
    tunnelPort: 4000,
    tomlPath: join(__dirname, 'shopify.app.toml'),
    envPath: join(__dirname, '.env'),
    maxRetries: 3,
    urlWaitTimeout: 30000
};

class ShopifyAppLauncher {
    constructor() {
        this.tunnelUrl = null;
        this.tunnelProcess = null;
        this.serverProcess = null;
    }

    // 🔥 Kill any process using our ports
    async killPorts() {
        const ports = [CONFIG.backendPort, CONFIG.frontendPort];
        for (const port of ports) {
            try {
                console.log(`🔍 Checking if port ${port} is in use...`);

                if (process.platform === 'win32') {
                    try {
                        const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
                        const lines = output.split('\n').filter(line => line.includes('LISTENING'));

                        if (lines.length > 0) {
                            const pid = lines[0].trim().split(/\s+/).pop();
                            console.log(`⚠️  Port ${port} is in use by PID ${pid}`);
                            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                            console.log(`✅ Killed process on port ${port}`);
                        } else {
                            console.log(`✅ Port ${port} is available`);
                        }
                    } catch (error) {
                        console.log(`✅ Port ${port} is available`);
                    }
                } else {
                    try {
                        execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
                        console.log(`✅ Killed process on port ${port}`);
                    } catch (error) {
                        console.log(`✅ Port ${port} is available`);
                    }
                }
            } catch (error) {
                console.log(`⚠️  Could not check port ${port}: ${error.message}`);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 🎯 Main execution flow
    async start() {
        try {
            console.log('🚀 Starting Shopify Recommendations App...\n');

            await this.killPorts();
            await this.startTunnel();
            await this.updateConfigurations();
            await this.deployToShopify();
            await this.startServer();

        } catch (error) {
            console.error('❌ Fatal error:', error.message);
            await this.cleanup();
            process.exit(1);
        }
    }

    // 📡 Step 1: Start Tunnel (Cloudflare with Localtunnel fallback)
    async startTunnel() {
        console.log('\n📡 Starting Tunnel...');

        try {
            console.log('  → Attempting Cloudflare Tunnel...');
            this.tunnelUrl = await this.tryCloudflare();
            console.log(`\n✅ Cloudflare Tunnel URL: ${this.tunnelUrl}\n`);
        } catch (error) {
            console.log(`\n⚠️  Cloudflare failed: ${error.message}`);
            console.log('  → Falling back to Localtunnel...');
            try {
                this.tunnelUrl = await this.tryLocaltunnel();
                console.log(`\n✅ Localtunnel URL: ${this.tunnelUrl}\n`);
            } catch (ltError) {
                throw new Error(`All tunnel services failed. Cloudflare: ${error.message}, Localtunnel: ${ltError.message}`);
            }
        }

        return this.tunnelUrl;
    }

    async tryCloudflare() {
        return new Promise((resolve, reject) => {
            const process = spawn('cloudflared', [
                'tunnel',
                '--url',
                `http://localhost:${CONFIG.tunnelPort}`
            ], { shell: true });

            this.tunnelProcess = process;
            let capturedUrl = null;

            const timeout = setTimeout(() => {
                process.kill();
                reject(new Error('Cloudflare timed out'));
            }, 45000); // 45s timeout for Cloudflare to reduce unnecessary localtunnel fallback

            const handleData = (data) => {
                const output = data.toString();
                if (output.includes('429 Too Many Requests')) {
                    clearTimeout(timeout);
                    process.kill();
                    reject(new Error('Rate limited (429)'));
                    return;
                }

                const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                if (match && !capturedUrl) {
                    capturedUrl = match[0];
                    clearTimeout(timeout);
                    resolve(capturedUrl);
                }
            };

            process.stdout.on('data', handleData);
            process.stderr.on('data', handleData);
        });
    }

    async tryLocaltunnel() {
        return new Promise((resolve, reject) => {
            const ltPath = join(__dirname, 'node_modules', '.bin', 'lt');
            console.log(`  → Starting Localtunnel using: ${ltPath}`);

            const process = spawn(ltPath, [
                '--port',
                CONFIG.tunnelPort.toString()
            ], { shell: true });

            this.tunnelProcess = process;
            let capturedUrl = null;

            const timeout = setTimeout(() => {
                process.kill();
                reject(new Error('Localtunnel timed out after 30s'));
            }, 30000);

            const handleData = (data) => {
                const output = data.toString();
                process.stdout.write(output); // Log output to terminal

                // Localtunnel prints "your url is: https://..."
                const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.loca\.lt/);
                if (match && !capturedUrl) {
                    capturedUrl = match[0];
                    clearTimeout(timeout);
                    resolve(capturedUrl);
                }
            };

            process.stdout.on('data', handleData);
            process.stderr.on('data', handleData);
        });
    }

    // 📝 Step 2: Update Configuration Files
    async updateConfigurations() {
        console.log('📝 Updating configuration files...\n');
        await this.updateToml();
        await this.updateEnv();
        console.log('✅ All configurations updated\n');
    }

    async updateToml() {
        try {
            let content = await readFile(CONFIG.tomlPath, 'utf8');

            content = content.replace(
                /application_url = ".*"/,
                `application_url = "${this.tunnelUrl}"`
            );

            content = content.replace(
                /redirect_urls = \[[^\]]*\]/,
                `redirect_urls = [ "${this.tunnelUrl}/auth/callback" ]`
            );

            // Update App Proxy URL
            // Match any url in [app_proxy] section or add it if missing (simplified regex for now assuming it exists)
            // We assume the [app_proxy] section exists and has a url field
            content = content.replace(
                /url = ".*api\/recommendations"/,
                `url = "${this.tunnelUrl}/api/recommendations"`
            );

            await writeFile(CONFIG.tomlPath, content, 'utf8');
            console.log('  ✓ shopify.app.toml updated');
        } catch (error) {
            throw new Error(`Failed to update TOML: ${error.message}`);
        }
    }

    async updateEnv() {
        try {
            let content = await readFile(CONFIG.envPath, 'utf8');

            const setEnvValue = (source, key, value) => {
                const pattern = new RegExp(`^${key}=.*$`, 'm');
                const nextLine = `${key}=${value}`;
                if (pattern.test(source)) {
                    return source.replace(pattern, nextLine);
                }
                return `${source.trimEnd()}\n${nextLine}\n`;
            };

            // Handle SHOPIFY_HOST replacement carefully
            const host = this.tunnelUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const apiKeyMatch = content.match(/^SHOPIFY_API_KEY=(.*)$/m);
            const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : '';

            content = setEnvValue(content, 'SHOPIFY_HOST', host);
            content = setEnvValue(content, 'FRONTEND_URL', this.tunnelUrl);
            if (apiKey) {
                content = setEnvValue(content, 'VITE_SHOPIFY_API_KEY', apiKey);
            }

            await writeFile(CONFIG.envPath, content, 'utf8');
            console.log('  ✓ .env updated');
        } catch (error) {
            throw new Error(`Failed to update ENV: ${error.message}`);
        }
    }

    // ☁️ Step 3: Deploy to Shopify
    async deployToShopify() {
        console.log('☁️  Deploying to Shopify...\n');

        return new Promise((resolve) => {
            const deploy = spawn('shopify', ['app', 'deploy', '--force'], {
                stdio: 'inherit',
                shell: true
            });

            deploy.on('close', (code) => {
                if (code === 0) {
                    console.log('\n✅ Successfully deployed to Shopify!\n');
                } else {
                    console.log('\n⚠️  Deploy had issues, but continuing...');
                    console.log('You may need to approve URLs in Partner Dashboard\n');
                }
                resolve();
            });

            deploy.on('error', () => {
                console.log('\n⚠️  Deploy error, but continuing...\n');
                resolve();
            });
        });
    }

    // 🚀 Step 4: Start Node Server
    async startServer() {
        console.log('🚀 Starting development servers...\n');
        console.log('━'.repeat(50));
        console.log(`📍 App URL: ${this.tunnelUrl}`);
        console.log(`🔗 Auth URL: ${this.tunnelUrl}/auth`);
        console.log(`🔗 Callback: ${this.tunnelUrl}/auth/callback`);
        console.log(`🔗 Recommendations API: ${this.tunnelUrl}/api/recommendations`);
        console.log(`🖥️  Frontend (local): http://localhost:${CONFIG.frontendPort}`);
        console.log(`⚙️  Backend (local): http://localhost:${CONFIG.backendPort}`);
        console.log('━'.repeat(50) + '\n');

        this.serverProcess = spawn('npm', ['run', 'dev'], {
            stdio: 'inherit',
            shell: true
        });

        this.serverProcess.on('close', (code) => {
            console.log(`\n⚠️  Server exited with code ${code}`);
            this.cleanup();
            process.exit(code);
        });
    }

    // 🧹 Cleanup processes
    async cleanup() {
        console.log('\n🛑 Shutting down gracefully...');

        if (this.serverProcess) {
            this.serverProcess.kill();
        }

        if (this.tunnelProcess) {
            this.tunnelProcess.kill();
        }

        await this.killPorts();
    }
}

// 🎬 Start the app
const launcher = new ShopifyAppLauncher();

process.on('SIGINT', async () => {
    await launcher.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await launcher.cleanup();
    process.exit(0);
});

launcher.start();
