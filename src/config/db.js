// src/config/db.js
import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max:              20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
    logger.error('[DB] Unexpected pool error', err);
});

// ทดสอบ connection เมื่อ start
pool.query('SELECT NOW()').then(() => {
    logger.info('[DB] PostgreSQL connected ✓');
}).catch(err => {
    logger.error('[DB] Connection failed:', err.message);
    process.exit(1);
});
