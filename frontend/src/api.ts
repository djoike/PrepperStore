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

export interface KnownIdentifierResponse extends BaseScanResponse {
  status: 'known'
  item: {
    id: number
    name: string
    threshold: number | null
  }
  locations: KnownIdentifierLocation[]
}

export type ScanResponse = UnknownIdentifierResponse | KnownIdentifierResponse

const API_BASE =
  import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export async function sendScan(barcode: string, mode: ScanMode): Promise<ScanResponse> {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ barcode, mode }),
  })

  if (!res.ok) {
    throw new Error(`Scan failed: ${res.status}`)
  }

  return res.json() as Promise<ScanResponse>
}
