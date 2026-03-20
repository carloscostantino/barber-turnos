import pg from 'pg';
import { env } from './env';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

