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
  warning?:
    | 'no_stock_available'
    | 'no_location_selected_for_in'
    | 'no_stock_in_selected_location'
}

export type ScanResponse = UnknownIdentifierResponse | KnownIdentifierResponse

export interface ItemSummary {
  id: number
  name: string
  threshold: number | null
}

const API_BASE =
  import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export async function login(password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status}`)
  }
}

export async function authCheck(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth-check`, {
    credentials: 'include',
  })

  if (res.status === 401) return false
  if (!res.ok) {
    throw new Error(`Auth check failed: ${res.status}`)
  }

  const data = (await res.json()) as { authenticated?: boolean }
  return data.authenticated === true
}

export async function fetchAllItems(): Promise<ItemSummary[]> {
  const res = await fetch(`${API_BASE}/api/items`, {
    credentials: 'include',
  })

  if (!res.ok) {
    throw new Error(`Fetch items failed: ${res.status}`)
  }

  const data = (await res.json()) as { items: ItemSummary[] }
  return data.items
}

export async function createItem(
  name: string,
  threshold: number | null,
): Promise<ItemSummary> {
  const res = await fetch(`${API_BASE}/api/items`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, threshold }),
  })

  if (!res.ok) {
    throw new Error(`Create item failed: ${res.status}`)
  }

  return res.json() as Promise<ItemSummary>
}

export async function linkIdentifier(
  itemId: number,
  identifier: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/item-identifiers`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ itemId, identifier }),
  })

  if (!res.ok) {
    throw new Error(`Link identifier failed: ${res.status}`)
  }
}

export async function adjustStock(
  itemId: number,
  locationId: number,
  delta: number,
): Promise<{
  item: { id: number; name: string; threshold: number | null }
  locations: { locationId: number; locationName: string; amount: number }[]
}> {
  const res = await fetch(`${API_BASE}/api/stock/adjust`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ itemId, locationId, delta }),
  })

  if (!res.ok) {
    throw new Error(`Adjust stock failed: ${res.status}`)
  }

  return res.json() as Promise<{
    item: { id: number; name: string; threshold: number | null }
    locations: { locationId: number; locationName: string; amount: number }[]
  }>
}

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
