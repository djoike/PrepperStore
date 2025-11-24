import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'

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
    origin: (origin, cb) => {
      // Allow server-to-server or curl (no origin)
      if (!origin) return cb(null, true)

      const allowedOrigins = [
        'http://localhost:5173', // Vite dev
        process.env.FRONTEND_ORIGIN || '',
      ].filter(Boolean)

      if (allowedOrigins.includes(origin)) {
        cb(null, true)
      } else {
        cb(new Error('Not allowed by CORS'), false)
      }
    },
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

  fastify.get('/', async () => {
    return { status: 'ok', service: 'prepperstore-backend' }
  })

  // Simple echo scan endpoint (no auth yet)
  fastify.post<{
    Body: { barcode: string; mode: 'IN' | 'OUT' | 'STATUS' }
  }>('/api/scan', async (request, reply) => {
    const { barcode, mode } = request.body

    // TODO: validate and store in DB
    fastify.log.info({ barcode, mode }, 'Received scan')

    return { ok: true, barcode, mode }
  })

  return fastify
}

async function start() {
  const fastify = await buildServer()

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' })
    fastify.log.info(`Server listening on port ${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
