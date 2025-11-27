import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  // Fail fast if misconfigured
  throw new Error('DATABASE_URL is not set')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // needed for Render's external Postgres
  },
})

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params)
  return result.rows as T[]
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await pool.query(text, params)
  return (result.rows[0] as T) ?? null
}
