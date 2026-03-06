/**
 * Database migration script.
 * Usage: node server/db/migrate.js
 *
 * Reads schema.sql and executes it against the configured PostgreSQL database.
 * Safe to run multiple times thanks to IF NOT EXISTS guards.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
    console.log('🔄 Running database migration...');

    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql = await fs.readFile(schemaPath, 'utf8');
        await pool.query(sql);
        console.log('✅ Database migration completed successfully.');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
