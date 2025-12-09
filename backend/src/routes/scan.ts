import { FastifyPluginAsync } from 'fastify'
import { query } from '../db'

type ScanMode = 'IN' | 'OUT' | 'STATUS'

interface ScanBody {
  barcode: string
  mode: ScanMode
  preferredLocationId?: number | null
}

interface ScanRow {
  identifier_id: number
  identifier: string
  item_id: number
  item_name: string
  item_threshold: number | null
  location_id: number | null
  location_name: string | null
  location_amount: number | null
}

const SCAN_SQL = `
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
`

function buildLocations(rows: ScanRow[]) {
  return rows
    .filter((r) => r.location_id !== null)
    .map((r) => ({
      locationId: r.location_id as number,
      locationName: r.location_name ?? 'Unknown location',
      amount: r.location_amount ?? 0,
    }))
}

const scanRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: ScanBody }>('/api/scan', async (request, reply) => {
    const { barcode, mode } = request.body
    const preferredLocationId = request.body.preferredLocationId ?? null

    if (!barcode || !barcode.trim()) {
      reply.code(400)
      return { error: 'Barcode is required' }
    }

    const trimmed = barcode.trim()

    // 1) Load identifier + item + stock + locations
    const rows = await query<ScanRow>(SCAN_SQL, [trimmed])

    // Unknown identifier
    if (rows.length === 0) {
      return {
        status: 'unknown_identifier' as const,
        mode,
        barcode: trimmed,
      }
    }

    const first = rows[0]

    if (mode === 'STATUS') {
      const locations = buildLocations(rows)

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
    }

    if (mode === 'IN') {
      const locations = buildLocations(rows)

      let chosenLocationId: number | null = null
      let chosenLocationName = 'Unknown location'
      let previousAmount = 0

      if (preferredLocationId !== null) {
        const preferredRow = rows.find(
          (r) => r.location_id === preferredLocationId,
        )

        if (preferredRow) {
          chosenLocationId = preferredLocationId
          chosenLocationName = preferredRow.location_name ?? 'Unknown location'
          previousAmount = preferredRow.location_amount ?? 0
        } else {
          const locationRows = await query<{ id: number; name: string }>(
            `
            SELECT id, name
            FROM location
            WHERE id = $1
            `,
            [preferredLocationId],
          )

          if (locationRows.length === 0) {
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
              change: null as null,
              warning: 'no_location_selected_for_in' as const,
            }
          }

          chosenLocationId = preferredLocationId
          chosenLocationName = locationRows[0].name ?? 'Unknown location'
          previousAmount = 0
        }
      } else {
        if (locations.length === 1) {
          chosenLocationId = locations[0].locationId
          chosenLocationName = locations[0].locationName
          previousAmount = locations[0].amount ?? 0
        } else {
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
            change: null as null,
            warning: 'no_location_selected_for_in' as const,
          }
        }
      }

      let newAmount = previousAmount

      if (rows.some((r) => r.location_id === chosenLocationId)) {
        const updateRows = await query<{ amount: number }>(
          `
          UPDATE item_stock
          SET amount = amount + 1
          WHERE item_id = $1
            AND location_id = $2
          RETURNING amount
          `,
          [first.item_id, chosenLocationId],
        )

        newAmount = updateRows[0].amount
      } else {
        const insertRows = await query<{ amount: number }>(
          `
          INSERT INTO item_stock (item_id, location_id, amount)
          VALUES ($1, $2, 1)
          RETURNING amount
          `,
          [first.item_id, chosenLocationId],
        )

        newAmount = insertRows[0].amount
      }

      const updatedRows = await query<ScanRow>(SCAN_SQL, [trimmed])
      const updatedLocations = buildLocations(updatedRows)

      return {
        status: 'known' as const,
        mode,
        barcode: first.identifier,
        item: {
          id: first.item_id,
          name: first.item_name,
          threshold: first.item_threshold,
        },
        locations: updatedLocations,
        change: {
          action: 'IN' as const,
          quantity: 1,
          locationId: chosenLocationId as number,
          locationName: chosenLocationName,
          previousAmount,
          newAmount,
        },
      }
    }

    // --- mode === OUT from here ---

    let chosen: ScanRow | null = null

    if (preferredLocationId !== null) {
      const preferredRow = rows.find(
        (r) => r.location_id === preferredLocationId,
      )

      if (preferredRow) {
        if ((preferredRow.location_amount ?? 0) > 0) {
          chosen = preferredRow
        } else {
          const locations = buildLocations(rows)

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
            change: null as null,
            warning: 'no_stock_in_selected_location' as const,
          }
        }
      }
    }

    // Find candidate locations with stock > 0
    const candidates = rows.filter(
      (r) => r.location_id !== null && (r.location_amount ?? 0) > 0,
    )

    if (candidates.length === 0) {
      const locations = buildLocations(rows)

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
        change: null as null,
        warning: 'no_stock_available' as const,
      }
    }

    // Pick location with highest amount (tie-breaker: lowest location_id)
    if (!chosen) {
      chosen = candidates[0]
      for (const c of candidates.slice(1)) {
        const currentAmount = chosen.location_amount ?? 0
        const candidateAmount = c.location_amount ?? 0

        if (
          candidateAmount > currentAmount ||
          (candidateAmount === currentAmount &&
            (c.location_id as number) < (chosen.location_id as number))
        ) {
          chosen = c
        }
      }
    }

    const chosenLocationId = chosen.location_id as number
    const chosenLocationName = chosen.location_name ?? 'Unknown location'
    const previousAmount = chosen.location_amount ?? 0

    // Decrement stock by 1, but never below 0
    const updateRows = await query<{ amount: number }>(
      `
      UPDATE item_stock
      SET amount = amount - 1
      WHERE item_id = $1
        AND location_id = $2
        AND amount > 0
      RETURNING amount
      `,
      [first.item_id, chosenLocationId],
    )

    if (updateRows.length === 0) {
      // Race condition or stock already zero; treat as no stock
      const locations = buildLocations(rows)

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
        change: null as null,
        warning: 'no_stock_available' as const,
      }
    }

    const newAmount = updateRows[0].amount

    // Re-load updated stock to return fresh amounts
    const updatedRows = await query<ScanRow>(SCAN_SQL, [trimmed])
    const locations = buildLocations(updatedRows)

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
      change: {
        action: 'OUT' as const,
        quantity: 1,
        locationId: chosenLocationId,
        locationName: chosenLocationName,
        previousAmount,
        newAmount,
      },
    }
  })
}

export default scanRoutes
