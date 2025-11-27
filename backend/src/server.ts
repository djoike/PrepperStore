import 'dotenv/config'
import { runMigrations } from './migrations'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import { queryOne } from './db'
import scanRoutes from './routes/scan'

const isProd = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT) || 3000

async function buildServer() {
  const fastify = Fastify({
    logger: true,
  })

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // we'll tune later if needed
  })

  // CORS – dev: allow Vite, prod: we'll set env
  await fastify.register(cors, {
    origin: ['http://localhost:5173'],
    credentials: true,
  })

  // Cookies (for sessions later)
  await fastify.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-secret-change-me',
    hook: 'onRequest',
  })

  // Health check
  fastify.get('/api/health', async () => {
    return { status: 'ok', uptime: process.uptime() }
  })

  fastify.get('/api/db-health', async () => {
    // Simple sanity check that DB is reachable
    const row = await queryOne<{ now: string }>('SELECT NOW() as now')
    return {
      status: 'ok',
      now: row?.now ?? null,
    }
  })

  fastify.get('/', async () => {
    return { status: 'ok', service: 'prepperstore-backend' }
  })

  await fastify.register(scanRoutes)
  
  return fastify
}

async function start() {
  const fastify = await buildServer()

  try {
    await runMigrations()

    await fastify.listen({ port: PORT, host: '0.0.0.0' })
    fastify.log.info(`Server listening on port ${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()