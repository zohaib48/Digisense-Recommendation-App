import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/shopify_recommendations',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Execute a query against the pool.
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 200) {
        console.warn(`⚠️  Slow DB query (${duration}ms):`, text.substring(0, 80));
    }
    return result;
}

/**
 * Get a client from the pool for transactions.
 */
export async function getClient() {
    return pool.connect();
}

export default pool;
