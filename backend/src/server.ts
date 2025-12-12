import 'dotenv/config'
import Fastify, { FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import { runMigrations } from './migrations'
import { queryOne } from './db'
import scanRoutes from './routes/scan'
import stockRoutes from './routes/stock'
import itemsRoutes from './routes/items'

const PORT = Number(process.env.PORT) || 3000
const PREPPERSTORE_PASSWORD = process.env.PREPPERSTORE_PASSWORD
const SESSION_COOKIE_NAME = 'ps_session'
const SESSION_VALUE = 'ok'
const SESSION_MAX_AGE_SECONDS = 60 * 24 * 60 * 60 // 60 days

function isAuthenticated(request: FastifyRequest) {
  const raw = request.cookies?.[SESSION_COOKIE_NAME]
  if (!raw) return false

  const unsigned = request.unsignCookie(raw)
  return unsigned.valid && unsigned.value === SESSION_VALUE
}

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
    secret: process.env.COOKIE_SECRET || 'dev-secret',
    hook: 'onRequest',
  })

  const authExemptRoutes = new Set([
    '/api/login',
    '/api/auth-check',
    '/api/health',
    '/api/db-health',
  ])

  fastify.addHook('preHandler', async (request, reply) => {
    const path = request.routeOptions.url

    if (!path || !path.startsWith('/api/')) return
    if (authExemptRoutes.has(path)) return
    if (isAuthenticated(request)) return

    reply.code(401)
    return { error: 'unauthorized' }
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

  fastify.post<{ Body: { password: string } }>('/api/login', async (request, reply) => {
    const { password } = request.body ?? {}

    if (!PREPPERSTORE_PASSWORD || password !== PREPPERSTORE_PASSWORD) {
      reply.code(401)
      return { error: 'invalid_credentials' }
    }

    reply.setCookie(SESSION_COOKIE_NAME, SESSION_VALUE, {
      signed: true,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })

    return { success: true }
  })

  fastify.get('/api/auth-check', async (request, reply) => {
    if (!isAuthenticated(request)) {
      reply.code(401)
      return { authenticated: false }
    }

    return { authenticated: true }
  })

  fastify.get('/', async () => {
    return { status: 'ok', service: 'prepperstore-backend' }
  })

  await fastify.register(scanRoutes)
  await fastify.register(stockRoutes)
  await fastify.register(itemsRoutes)
  
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
