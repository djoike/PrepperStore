import { FastifyPluginAsync } from 'fastify'
import { query, queryOne } from '../db'

interface ItemRow {
  id: number
  name: string
  threshold: number | null
}

const itemsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/items', async () => {
    const rows = await query<ItemRow>(
      `
      SELECT id, name, threshold
      FROM item
      ORDER BY name ASC
      `,
    )

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        threshold: row.threshold,
      })),
    }
  })

  fastify.post<{ Body: { name: string; threshold?: number | null } }>(
    '/api/items',
    async (request, reply) => {
      const { name } = request.body
      const threshold = request.body.threshold

      const trimmedName = typeof name === 'string' ? name.trim() : ''

      if (!trimmedName) {
        reply.code(400)
        return { error: 'name must be a non-empty string' }
      }

      let normalizedThreshold: number | null = null
      if (threshold !== undefined) {
        if (threshold === null) {
          normalizedThreshold = null
        } else if (typeof threshold === 'number' && Number.isFinite(threshold)) {
          normalizedThreshold = threshold
        } else {
          reply.code(400)
          return { error: 'threshold must be a number or null' }
        }
      }

      const item = await queryOne<ItemRow>(
        `
        INSERT INTO item (name, threshold)
        VALUES ($1, $2)
        RETURNING id, name, threshold
        `,
        [trimmedName, normalizedThreshold],
      )

      return item
    },
  )

  fastify.post<{ Body: { itemId: number; identifier: string } }>(
    '/api/item-identifiers',
    async (request, reply) => {
      const { itemId, identifier } = request.body

      if (!Number.isFinite(itemId)) {
        reply.code(400)
        return { error: 'itemId must be a number' }
      }

      const trimmedIdentifier =
        typeof identifier === 'string' ? identifier.trim() : ''

      if (!trimmedIdentifier) {
        reply.code(400)
        return { error: 'identifier must be a non-empty string' }
      }

      const item = await queryOne<ItemRow>(
        `
        SELECT id, name, threshold
        FROM item
        WHERE id = $1
        `,
        [itemId],
      )

      if (!item) {
        reply.code(404)
        return { error: 'Item not found' }
      }

      const identifierType = await queryOne<{ id: number }>(
        `
        SELECT id
        FROM item_identifier_type
        WHERE name = 'EAN13'
        LIMIT 1
        `,
      )

      if (!identifierType) {
        reply.code(500)
        return { error: 'EAN13 identifier type not configured' }
      }

      await query(
        `
        INSERT INTO item_identifier (item_id, identifier, item_identifier_type)
        VALUES ($1, $2, $3)
        `,
        [itemId, trimmedIdentifier, identifierType.id],
      )

      return { success: true }
    },
  )
}

export default itemsRoutes
