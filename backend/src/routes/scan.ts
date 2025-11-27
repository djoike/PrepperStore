import { FastifyPluginAsync } from 'fastify'
import { query } from '../db'

type ScanMode = 'IN' | 'OUT' | 'STATUS'

interface ScanBody {
  barcode: string
  mode: ScanMode
}

const scanRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: ScanBody }>('/api/scan', async (request, reply) => {
    const { barcode, mode } = request.body

    if (!barcode || !barcode.trim()) {
      reply.code(400)
      return { error: 'Barcode is required' }
    }

    const trimmed = barcode.trim()

    // 1) Find identifier + joined item + stock + location
    const rows = await query<{
      identifier_id: number
      identifier: string
      item_id: number
      item_name: string
      item_threshold: number | null
      location_id: number | null
      location_name: string | null
      location_amount: number | null
    }>(
      `
      SELECT
        ii.id AS identifier_id,
        ii.identifier AS identifier,
        i.id AS item_id,
        i.name AS item_name,
        i.threshold AS item_threshold,
        s.location_id AS location_id,
        l.name AS location_name,
        s.amount AS location_amount
      FROM item_identifier ii
      JOIN item i ON i.id = ii.item_id
      LEFT JOIN item_stock s ON s.item_id = i.id
      LEFT JOIN location l ON l.id = s.location_id
      WHERE ii.identifier = $1
      `,
      [trimmed],
    )

    // 2) Unknown identifier: signal to frontend that we need user input
    if (rows.length === 0) {
      return {
        status: 'unknown_identifier' as const,
        mode,
        barcode: trimmed,
      }
    }

    // 3) Known identifier: normalize into item + stock per location
    const first = rows[0]

    const locations = rows
      .filter((r) => r.location_id !== null)
      .map((r) => ({
        locationId: r.location_id!,
        locationName: r.location_name!,
        amount: r.location_amount ?? 0,
      }))

    // No stock change yet here – this is just "what is this and what's the current state?"
    return {
      status: 'known' as const,
      mode,
      barcode: first.identifier,
      item: {
        id: first.item_id,
        name: first.item_name,
        threshold: first.item_threshold,
      },
      locations,
    }
  })
}

export default scanRoutes
