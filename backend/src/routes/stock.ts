import { FastifyPluginAsync } from 'fastify'
import { query, queryOne } from '../db'

interface AdjustBody {
  itemId: number
  locationId: number
  delta: number
}

interface ItemRow {
  id: number
  name: string
  threshold: number | null
}

interface StockRow {
  id: number
  amount: number
}

interface LocationRow {
  location_id: number
  location_name: string | null
  amount: number
}

function mapLocations(rows: LocationRow[]) {
  return rows.map((row) => ({
    locationId: row.location_id,
    locationName: row.location_name ?? 'Unknown location',
    amount: row.amount ?? 0,
  }))
}

const stockRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: AdjustBody }>('/api/stock/adjust', async (request, reply) => {
    const { itemId, locationId, delta } = request.body

    if (
      typeof itemId !== 'number' ||
      typeof locationId !== 'number' ||
      typeof delta !== 'number' ||
      !Number.isFinite(itemId) ||
      !Number.isFinite(locationId) ||
      !Number.isFinite(delta)
    ) {
      reply.code(400)
      return { error: 'itemId, locationId, and delta must be numbers' }
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

    const location = await queryOne<{ id: number; name: string | null }>(
      `
      SELECT id, name
      FROM location
      WHERE id = $1
      `,
      [locationId],
    )

    if (!location) {
      reply.code(404)
      return { error: 'Location not found' }
    }

    const existingStock = await queryOne<StockRow>(
      `
      SELECT id, amount
      FROM item_stock
      WHERE item_id = $1
        AND location_id = $2
      `,
      [itemId, locationId],
    )

    if (existingStock) {
      let newAmount = existingStock.amount + delta
      if (newAmount < 0) newAmount = 0

      await query(
        `
        UPDATE item_stock
        SET amount = $1
        WHERE id = $2
        `,
        [newAmount, existingStock.id],
      )
    } else if (delta > 0) {
      await query(
        `
        INSERT INTO item_stock (item_id, location_id, amount)
        VALUES ($1, $2, $3)
        `,
        [itemId, locationId, delta],
      )
    }

    const locationRows = await query<LocationRow>(
      `
      SELECT
        s.location_id,
        l.name AS location_name,
        s.amount
      FROM item_stock s
      JOIN location l ON l.id = s.location_id
      WHERE s.item_id = $1
      ORDER BY s.location_id
      `,
      [itemId],
    )

    return {
      item: {
        id: item.id,
        name: item.name,
        threshold: item.threshold,
      },
      locations: mapLocations(locationRows),
    }
  })
}

export default stockRoutes
