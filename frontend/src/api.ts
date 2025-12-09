export type ScanMode = 'IN' | 'OUT' | 'STATUS'

export interface BaseScanResponse {
  mode: ScanMode
  barcode: string
}

export interface UnknownIdentifierResponse extends BaseScanResponse {
  status: 'unknown_identifier'
}

export interface KnownIdentifierLocation {
  locationId: number
  locationName: string
  amount: number
}

export interface ChangeInfo {
  action: 'OUT' | 'IN'
  quantity: number
  locationId: number
  locationName: string
  previousAmount: number
  newAmount: number
}

export interface KnownIdentifierResponse extends BaseScanResponse {
  status: 'known'
  item: {
    id: number
    name: string
    threshold: number | null
  }
  locations: KnownIdentifierLocation[]
  change?: ChangeInfo | null
  warning?: 'no_stock_available' | 'no_location_selected_for_in'
}

export type ScanResponse = UnknownIdentifierResponse | KnownIdentifierResponse

const API_BASE =
  import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export async function sendScan(
  barcode: string,
  mode: ScanMode,
  preferredLocationId?: number | null,
): Promise<ScanResponse> {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      barcode,
      mode,
      preferredLocationId: preferredLocationId ?? null,
    }),
  })

  if (!res.ok) {
    throw new Error(`Scan failed: ${res.status}`)
  }

  return res.json() as Promise<ScanResponse>
}
