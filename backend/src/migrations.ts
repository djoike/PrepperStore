import 'dotenv/config'
import { Client } from 'pg'
import fs from 'fs'
import path from 'path'

const migrationsDir = path.join(process.cwd(), 'migrations')

export async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false,
    },
  })
  await client.connect()

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

const { rows } = await client.query<{ name: string }>(
  'SELECT name FROM schema_migrations',
)
const applied = new Set<string>(rows.map((r) => r.name))

  for (const file of files) {
    if (applied.has(file)) continue

    const fullPath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(fullPath, 'utf8')

    console.log('Running migration:', file)
    await client.query(sql)
    await client.query(
      'INSERT INTO schema_migrations (name) VALUES ($1)',
      [file],
    )
  }

  await client.end()
}
