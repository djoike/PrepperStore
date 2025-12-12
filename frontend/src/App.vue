<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  sendScan,
  adjustStock,
  fetchAllItems,
  createItem,
  linkIdentifier,
  login,
  authCheck,
  type ScanMode,
  type ScanResponse,
  type ItemSummary,
} from './api'
import headerLogo from '../assets/logo.png'

const isAuthenticated = ref(false)
const authLoading = ref(true)
const loginPassword = ref('')
const loginError = ref<string | null>(null)
const loginInputRef = ref<HTMLInputElement | null>(null)

const scanValue = ref('')
const mode = ref<ScanMode>('OUT')
const lastResponse = ref<ScanResponse | null>(null)
const isSubmitting = ref(false)
const scanLocked = ref(false)
const error = ref<string | null>(null)
const scanInput = ref<HTMLInputElement | null>(null)
const unknownInError = ref<string | null>(null)
const resultClearTimer = ref<number | null>(null)
const newItemInputRef = ref<HTMLInputElement | null>(null)

// New: location selection state
const selectedLocationId = ref<number | null>(null)
const selectedLocationName = ref<string | null>(null)

// Unknown-IN resolution state
const allItems = ref<ItemSummary[]>([])
const newItemName = ref('')
const newItemThreshold = ref<number | null>(null)
const highlightedIndex = ref(-1)

const matchingItems = computed(() =>
  newItemName.value
    ? allItems.value.filter((item) =>
        item.name.toLowerCase().includes(newItemName.value.toLowerCase()),
      )
    : [],
)

const showUnknownInModal = computed(
  () =>
    lastResponse.value?.status === 'unknown_identifier' &&
    mode.value === 'IN',
)

const limitedLocations = computed(() =>
  lastResponse.value?.status === 'known'
    ? lastResponse.value.locations.slice(0, 3)
    : [],
)

const totalStock = computed(() => {
  if (lastResponse.value?.status !== 'known') return null
  return lastResponse.value.locations.reduce((sum, loc) => sum + loc.amount, 0)
})

const statusText = computed(() => {
  if (error.value) return error.value

  const resp = lastResponse.value
  if (!resp) return 'Ingen scanning endnu'

  if (resp.status === 'unknown_identifier') {
    return mode.value === 'IN'
      ? 'Ukendt kode - kræver handling'
      : 'Ukendt kode'
  }

  if (resp.status === 'known') {
    if (resp.warning === 'no_stock_available') return 'Intet lager'
    if (resp.warning === 'no_stock_in_selected_location')
      return 'Ingen lager i valgt lokation'
    if (resp.warning === 'no_location_selected_for_in')
      return 'Vælg lokation for IND'

    if (resp.change?.action === 'OUT') {
      return `Tog ${resp.change.quantity} fra ${resp.change.locationName}`
    }
    if (resp.change?.action === 'IN') {
      return `Tilføjede ${resp.change.quantity ?? 1} til ${resp.change.locationName}`
    }
    return 'OK'
  }

  return '—'
})

function clearResultTimer() {
  if (resultClearTimer.value !== null) {
    window.clearTimeout(resultClearTimer.value)
    resultClearTimer.value = null
  }
}

function scheduleResultClear() {
  clearResultTimer()

  if (
    lastResponse.value &&
    (lastResponse.value.status === 'known' ||
      lastResponse.value.status === 'unknown_identifier')
  ) {
    resultClearTimer.value = window.setTimeout(() => {
      lastResponse.value = null
      error.value = null
    }, 60_000)
  }
}

watch(newItemName, () => {
  highlightedIndex.value = -1
})

watch(showUnknownInModal, async (open) => {
  if (open) {
    unknownInError.value = null
    newItemName.value = ''
    newItemThreshold.value = null
    highlightedIndex.value = -1
    allItems.value = await fetchAllItems()
    nextTick(() => newItemInputRef.value?.focus())
  }
})

watch(
  () => lastResponse.value,
  () => {
    scheduleResultClear()
  },
)

// Optional: hardcoded location definitions for now
const LOCATION_DEFS: Record<string, { id: number; name: string }> = {
  '1': { id: 1, name: 'Viktualierum' },
  '2': { id: 2, name: 'Kontor' },
  '3': { id: 3, name: 'Kummefryser' },
}

function setMode(newMode: ScanMode) {
  mode.value = newMode
}

function setLocation(id: number, name: string) {
  selectedLocationId.value = id
  selectedLocationName.value = name
}

function focusInput() {
  nextTick(() => {
    if (!isAuthenticated.value) return
    if (showUnknownInModal.value) return
    if (scanLocked.value) return
    scanInput.value?.focus()
  })
}

function cancelUnknownIn() {
  if (lastResponse.value?.status === 'unknown_identifier') {
    lastResponse.value = null
  }
  unknownInError.value = null
  newItemName.value = ''
  newItemThreshold.value = null
  highlightedIndex.value = -1
  scanLocked.value = false
  focusInput()
}

// Returns true if this was a command and has been handled
function handleCommand(raw: string): boolean {
  if (!raw.startsWith('CMD:')) return false

  const parts = raw.split(':')
  if (parts.length < 3) return false

  const type = parts[1]
  const value = parts[2]

  if (!type || !value) return false

  if (type === 'MODE') {
    if (value === 'IN' || value === 'OUT' || value === 'STATUS') {
      setMode(value as ScanMode)
      return true
    }
    return false
  }

  if (type === 'LOC') {
    const locDef = LOCATION_DEFS[value]
    if (locDef) {
      setLocation(locDef.id, locDef.name)
      return true
    }
    return false
  }

  if (type === 'ASSET') {
    if (value === 'NEW') {
      // Later: enter asset-tag creation mode
      // For now we just swallow it so it doesn't get sent to backend
      // e.g. we could set a flag here
      // assetTagMode.value = true
      return true
    }
    return false
  }

  return false
}

async function onSubmit() {
  if (!scanValue.value || isSubmitting.value) return

  const raw = scanValue.value.trim()
  if (!raw) return

  // 1) Try to handle as a command
  if (handleCommand(raw)) {
    scanValue.value = ''
    // Optionally keep lastResponse visible, or clear it:
    // lastResponse.value = null
    focusInput()
    return
  }

  // 2) Otherwise treat as a product/asset barcode
  scanLocked.value = true
  isSubmitting.value = true
  error.value = null

  try {
    const result = await sendScan(raw, mode.value, selectedLocationId.value)
    lastResponse.value = result
    scanValue.value = ''
  } catch (err: any) {
    error.value = err?.message ?? 'Ukendt fejl'
    lastResponse.value = null
  } finally {
    isSubmitting.value = false
    scanLocked.value = false
    focusInput()
  }
}

async function adjustLocation(loc: { locationId: number }, delta: number) {
  if (!lastResponse.value || lastResponse.value.status !== 'known') return

  const itemId = lastResponse.value.item.id

  try {
    scanLocked.value = true
    const result = await adjustStock(itemId, loc.locationId, delta)
    lastResponse.value = {
      ...lastResponse.value,
      item: result.item,
      locations: result.locations,
    }
  } finally {
    scanLocked.value = false
    focusInput()
  }
}

async function resolveUnknownByCreate() {
  unknownInError.value = null

  if (
    !lastResponse.value ||
    lastResponse.value.status !== 'unknown_identifier' ||
    mode.value !== 'IN'
  ) {
    return
  }

  if (!selectedLocationId.value) {
    unknownInError.value = 'Vælg en lokation før du opretter varen.'
    return
  }

  const trimmedName = newItemName.value.trim()
  if (!trimmedName) return

  const barcode = lastResponse.value.barcode
  error.value = null
  scanLocked.value = true

  try {
    const normalizedThreshold = Number.isFinite(newItemThreshold.value)
      ? newItemThreshold.value
      : null

    const created = await createItem(trimmedName, normalizedThreshold)
    await linkIdentifier(created.id, barcode)

    newItemName.value = ''
    newItemThreshold.value = null

    const result = await sendScan(
      barcode,
      'IN',
      selectedLocationId.value ?? null,
    )
    lastResponse.value = result
  } catch (err: any) {
    error.value = err?.message ?? 'Ukendt fejl'
  } finally {
    scanLocked.value = false
    focusInput()
  }
}

async function resolveUnknownByLink(item: ItemSummary) {
  unknownInError.value = null

  if (
    !lastResponse.value ||
    lastResponse.value.status !== 'unknown_identifier' ||
    mode.value !== 'IN'
  ) {
    return
  }

  if (!selectedLocationId.value) {
    unknownInError.value = 'Vælg en lokation før du linker varen.'
    return
  }

  const barcode = lastResponse.value.barcode
  error.value = null
  scanLocked.value = true

  try {
    await linkIdentifier(item.id, barcode)

    const result = await sendScan(
      barcode,
      'IN',
      selectedLocationId.value ?? null,
    )
    lastResponse.value = result
  } catch (err: any) {
    error.value = err?.message ?? 'Ukendt fejl'
  } finally {
    scanLocked.value = false
    focusInput()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!showUnknownInModal.value) return

  if (e.key === 'Escape') {
    cancelUnknownIn()
    return
  }

  const totalMatches = matchingItems.value.length
  if (e.key === 'ArrowDown' && totalMatches > 0) {
    highlightedIndex.value =
      highlightedIndex.value >= totalMatches - 1 ? 0 : highlightedIndex.value + 1
    e.preventDefault()
    return
  }

  if (e.key === 'ArrowUp' && totalMatches > 0) {
    highlightedIndex.value =
      highlightedIndex.value <= 0 ? totalMatches - 1 : highlightedIndex.value - 1
    e.preventDefault()
    return
  }

  if (e.key === 'Enter') {
    if (highlightedIndex.value >= 0) {
      const match = matchingItems.value[highlightedIndex.value]
      if (match) {
        resolveUnknownByLink(match)
        e.preventDefault()
      }
    }
    return
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onMounted(async () => {
  try {
    isAuthenticated.value = await authCheck()
    if (isAuthenticated.value) {
      focusInput()
    }
  } finally {
    authLoading.value = false
    if (!isAuthenticated.value) {
      nextTick(() => loginInputRef.value?.focus())
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  clearResultTimer()
})

async function onLoginSubmit() {
  try {
    loginError.value = null
    await login(loginPassword.value)
    isAuthenticated.value = true
    focusInput()
  } catch (err) {
    loginError.value = 'Forkert adgangskode'
    nextTick(() => loginInputRef.value?.focus())
  }
}
</script>


<template>
  <div class="app">
    <header class="app__header">
      <img class="app__logo" :src="headerLogo" alt="PrepperStore logo" />
    </header>

    <main class="app__main">
      <div v-if="authLoading" class="card login-card">
        Logger ind…
      </div>

      <div v-else-if="!isAuthenticated" class="login-panel card">
        <form @submit.prevent="onLoginSubmit" class="login-form">
          <label class="login-label" for="login-password">Adgangskode</label>
          <input
            id="login-password"
            v-model="loginPassword"
            ref="loginInputRef"
            type="password"
            class="login-input"
            placeholder="••••••••"
            autocomplete="current-password"
            autofocus
          />
          <button type="submit" class="login-submit">Log ind</button>
        </form>
        <p v-if="loginError" class="status status--error login-error" role="alert">{{ loginError }}</p>
      </div>

      <div v-else class="scan">
        <div class="scan__controls">
          <form @submit.prevent="onSubmit" class="scan-form">
            <div class="scan-form__header">
              <p class="status-line">
                Tilstand: {{ mode }}
                <span v-if="selectedLocationName">
                  · Lokation: {{ selectedLocationName }}
                </span>
                <span v-else>
                  · Lokation: ingen valgt
                </span>
              </p>
              <span
                class="lock-indicator"
                :class="{ 'lock-indicator--locked': scanLocked || isSubmitting }"
              >
                {{ scanLocked || isSubmitting ? 'Låst' : 'Klar' }}
              </span>
            </div>
            <input v-model="scanValue" ref="scanInput" class="scan-form__input" type="text" autofocus autocomplete="off"
              placeholder="Scan eller indtast stregkode…" :disabled="scanLocked" />

            <button type="submit" class="scan-form__submit" :disabled="isSubmitting">
              {{ isSubmitting ? 'Arbejder…' : 'Send' }}
            </button>
          </form>
        </div>

        <div class="scan__output">
          <div class="terminal-panel card">
            <div class="terminal-row terminal-row--full">
              <span class="terminal-label">Varenavn</span>
              <span class="terminal-value">
                <template v-if="lastResponse?.status === 'known'">
                  {{ lastResponse.item.name }}
                </template>
                <template v-else-if="lastResponse?.status === 'unknown_identifier'">
                  Ukendt
                </template>
                <template v-else>
                  —
                </template>
              </span>
            </div>
            <div class="terminal-grid">
              <div class="terminal-row">
                <span class="terminal-label">Handling</span>
                <span class="terminal-value">
                  {{ lastResponse ? lastResponse.mode : mode }}
                </span>
              </div>
              <div class="terminal-row">
                <span class="terminal-label">Lokation</span>
                <span class="terminal-value">
                  {{ selectedLocationName || '(ingen valgt)' }}
                </span>
              </div>
              <div class="terminal-row">
                <span class="terminal-label">Scannet kode</span>
                <span class="terminal-value">
                  {{ lastResponse ? lastResponse.barcode : '—' }}
                </span>
              </div>
              <div class="terminal-row">
                <span class="terminal-label">Minimum/Total</span>
                <span class="terminal-value">
                  <template v-if="lastResponse?.status === 'known'">
                    <span v-if="lastResponse.item.threshold !== null">
                      Minimum {{ lastResponse.item.threshold }} · Total {{ totalStock ?? 0 }}
                    </span>
                    <span v-else>
                      Minimum — · Total {{ totalStock ?? 0 }}
                    </span>
                  </template>
                  <template v-else>
                    —
                  </template>
                </span>
              </div>
              <div class="terminal-row terminal-row--message">
                <span class="terminal-label">Besked</span>
                <span class="terminal-value terminal-value--status">
                  {{ statusText }}
                </span>
              </div>
              <div class="terminal-row terminal-row--locations">
                <span class="terminal-label">Lager</span>
                <div class="terminal-locations">
                  <template v-if="limitedLocations.length > 0">
                    <div v-for="loc in limitedLocations" :key="loc.locationId" class="terminal-loc">
                      <span class="terminal-loc__name">{{ loc.locationName }}</span>
                      <div class="terminal-loc__controls" v-if="lastResponse?.status === 'known'">
                        <button
                          type="button"
                          class="loc-btn--tiny"
                          :aria-label="`Træk 1 fra ${loc.locationName}`"
                          @click="adjustLocation(loc, -1)"
                        >
                          -
                        </button>
                        <span class="terminal-loc__amount">{{ loc.amount }}</span>
                        <button
                          type="button"
                          class="loc-btn--tiny"
                          :aria-label="`Læg 1 til ${loc.locationName}`"
                          @click="adjustLocation(loc, +1)"
                        >
                          +
                        </button>
                      </div>
                      <span v-else class="terminal-loc__amount">{{ loc.amount }}</span>
                    </div>
                  </template>
                  <p v-else class="muted">Ingen lagerlinjer</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <div v-if="isAuthenticated && showUnknownInModal" class="modal-backdrop">
      <div class="modal">
        <div class="modal__header">
          <h2>Ukendt varekode</h2>
          <button type="button" class="modal-close" @click="cancelUnknownIn">
            Luk (Esc)
          </button>
        </div>
        <p class="muted modal__hint">
          Tilføj ny vare herunder
        </p>
        <p v-if="unknownInError" class="status status--error modal__error">
          {{ unknownInError }}
        </p>

        <div class="modal__row modal__row--name">
          <span class="modal__label">Varenavn</span>
          <div class="modal__content modal__content--stack">
            <input
              v-model="newItemName"
              type="text"
              class="modal-input"
              ref="newItemInputRef"
              placeholder="Søg eller opret navn"
            />
            <ul v-if="newItemName && matchingItems.length > 0" class="suggestions">
              <li
                v-for="(item, index) in matchingItems"
                :key="item.id"
                :class="['suggestion', { 'suggestion--active': index === highlightedIndex }]"
                @click="resolveUnknownByLink(item)"
              >
                {{ item.name }}
              </li>
            </ul>
          </div>
        </div>

        <div class="modal__row modal__row--threshold">
          <span class="modal__label">Tærskel</span>
          <div class="modal__content">
            <input
              id="threshold-input"
              v-model.number="newItemThreshold"
              type="number"
              class="modal-input"
              placeholder="Valgfrit"
            />
          </div>
        </div>

        <div class="modal__row modal__row--location">
          <span class="modal__label">Lokation</span>
          <div class="modal__content">
            <div class="loc-pills">
              <button
                type="button"
                class="loc-pill"
                :class="{ 'loc-pill--active': selectedLocationId === 1 }"
                @click="setLocation(1, 'Viktualierum')"
              >
                Viktualierum
              </button>
              <button
                type="button"
                class="loc-pill"
                :class="{ 'loc-pill--active': selectedLocationId === 2 }"
                @click="setLocation(2, 'Kontor')"
              >
                Kontor
              </button>
              <button
                type="button"
                class="loc-pill"
                :class="{ 'loc-pill--active': selectedLocationId === 3 }"
                @click="setLocation(3, 'Kummefryser')"
              >
                Kummefryser
              </button>
            </div>
          </div>
        </div>

        <div class="modal__actions">
          <button
            type="button"
            class="scan-form__submit"
            @click="resolveUnknownByCreate"
          >
            Opret vare
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
html,
body,
#app {
  height: 100%;
  margin: 0;
  padding: 0;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.app {
  height: 100vh;
  width: 100%;
  max-width: 100vw;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  background: #0f172a;
  color: #e5e7eb;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  &__header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border-bottom: 1px solid #1f2937;
    background: #0b1223;
  }

  &__title {
    margin: 0;
    font-size: 1.1rem;
  }

  &__main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    padding: 0 0.75rem 0.75rem 0.75rem;
    gap: 0.75rem;
    width: 100%;
    overflow: hidden;
  }
}

.logo-placeholder {
  width: 36px;
  height: 36px;
  border-radius: 0.5rem;
  border: 1px dashed #1f2937;
  background: #020617;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.app__logo {
  display: block;
  max-width: 140px;
  max-height: 32px;
  padding: 0.15rem 0.25rem;
  width: auto;
  height: auto;
  object-fit: contain;
}

.scan-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  &__input {
    padding: 0.85rem 0.9rem;
    border-radius: 0.5rem;
    border: 1px solid #1f2937;
    background: #020617;
    color: inherit;
    font-size: 1.25rem;
    font-family: ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;

    &:focus {
      outline: 2px solid #3b82f6;
      outline-offset: 0;
    }
  }

  &__submit {
    padding: 0.85rem 1rem;
    border-radius: 0.5rem;
    border: none;
    background: #3b82f6;
    color: white;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      background: #2563eb;
    }

    &:active {
      transform: translateY(1px);
    }
  }
}

.scan {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.scan__controls {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #1f2937;
  border-radius: 0.75rem;
  background: #0b1223;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  position: sticky;
  top: 0.75rem;
  z-index: 5;
  margin-bottom:0.75rem;
}

.scan__output {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
}

.status {
  font-size: 0.9rem;
  margin: 0 0 0.5rem;

  &--ok {
    color: #22c55e;
  }

  &--error {
    color: #f97316;
  }
}

.card {
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  background: #020617;
  border: 1px solid #1f2937;

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.1rem;
  }

  h3 {
    margin: 0.75rem 0 0.25rem;
    font-size: 0.95rem;
  }

  p {
    margin: 0.25rem 0;
  }
}

.login-card {
  display: none;
}

.login-panel {
  width: 100%;
  padding: 0.75rem;
  background: #0b1223;
  border: 1px solid #1f2937;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.login-form {
  display: grid;
  grid-template-columns: minmax(80px, auto) minmax(0, 1fr) minmax(82px, auto);
  gap: 0.4rem;
  align-items: center;
}

.login-label {
  color: #cbd5e1;
  font-size: 0.9rem;
  white-space: nowrap;
}

.login-input {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid #1f2937;
  background: #020617;
  color: #e5e7eb;
  font-size: 1.05rem;
  font-family: ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;

  &:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 0;
  }
}

.login-submit {
  padding: 0.55rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid #1f2937;
  background: #3b82f6;
  color: white;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: #2563eb;
  }

  &:active {
    transform: translateY(1px);
  }
}

.login-error {
  margin: 0;
  font-size: 0.9rem;
}

.muted {
  color: #9ca3af;
  font-size: 0.85rem;
}

.locations {
  list-style: none;
  padding: 0;
  margin: 0.25rem 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  .loc-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    gap: 0.5rem;
  }

  .loc-name {
    color: #e5e7eb;
  }

  .loc-amount {
    font-variant-numeric: tabular-nums;
    min-width: 1.5rem;
    text-align: center;
  }
}

.loc-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.loc-btn--tiny {
  padding: 0.1rem 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid #4b5563;
  background: #0f172a;
  color: #e5e7eb;
  cursor: pointer;

  &:hover {
    background: #1f2937;
  }

  &:active {
    transform: translateY(1px);
  }

  &:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
    border-color: #3b82f6;
  }
}

/* these were mistakenly nested inside .locations before */

.status-line {
  margin: 0;
  padding: 0.35rem 0.5rem;
  font-size: 0.9rem;
  color: #cbd5e1;
  background: #0f172a;
  border: 1px solid #1f2937;
  border-radius: 0.5rem;
}

.lock-indicator {
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  border: 1px solid #1f2937;
  background: #0f172a;
  color: #22c55e;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;

  &--locked {
    color: #fbbf24;
    border-color: #4b5563;
  }
}

.terminal-panel {
  width: 100%;
  flex: 1;
  min-height: 0;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  overflow: hidden;
}

.terminal-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0.75rem;
  align-items: flex-start;
}

.terminal-row--full {
  width: 100%;
}

.terminal-row--locations {
  flex: 1;
}

.terminal-row--message {
  align-self: start;
}

.terminal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 0.75rem;
  align-items: flex-start;
}

.terminal-label {
  color: #94a3b8;
  font-size: 0.9rem;
}

.terminal-value {
  color: #e5e7eb;
  font-size: 1rem;
  word-break: break-word;

  &--status {
    color: #22c55e;
  }
}

.terminal-locations {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.terminal-loc {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #1f2937;
  border-radius: 0.5rem;
  background: #0b1223;
}

.terminal-loc__name {
  color: #cbd5e1;
  font-size: 0.9rem;
}

.terminal-loc__controls {
  display: inline-flex;
  align-items: flex-start;
  gap: 0.35rem;
}

.terminal-loc__amount {
  min-width: 1.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.unknown-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.unknown-section {
  border: 1px solid #1f2937;
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: #0b1223;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.suggestions {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid #1f2937;
  border-radius: 0.5rem;
  background: #0b1223;
  max-height: 160px;
  overflow-y: auto;
}

.suggestion {
  padding: 0.5rem 0.75rem;
  cursor: pointer;

  &--active {
    background: #111827;
    color: #e5e7eb;
  }

  & + & {
    border-top: 1px solid #1f2937;
  }
}

.suggestions {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid #1f2937;
  border-radius: 0.5rem;
  background: #0b1223;
  max-height: 200px;
  overflow-y: auto;
}

.suggestion {
  padding: 0.5rem 0.75rem;
  cursor: pointer;

  &--active {
    background: #111827;
    color: #e5e7eb;
  }

  & + & {
    border-top: 1px solid #1f2937;
  }
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal {
  width: 100%;
  max-width: 540px;
  max-height: 360px;
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  background: #020617;
  border: 1px solid #1f2937;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  overflow: hidden;

  h2 {
    margin: 0;
  }
}

.modal__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.modal__hint {
  margin: 0;
  font-size: 0.9rem;
}

.modal__error {
  margin: 0;
}

.modal-close {
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #4b5563;
  background: #0b1223;
  color: #e5e7eb;
  cursor: pointer;

  &:hover {
    background: #111827;
  }
}

.modal__row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 0.5rem;
  align-items: start;
}

.modal__label {
  color: #94a3b8;
  font-size: 0.9rem;
  padding-top: 0.35rem;
}

.modal__content {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.modal__content--stack {
  gap: 0.4rem;
}

.modal-input {
  width: 100%;
  padding: 0.65rem 0.8rem;
  border-radius: 0.5rem;
  border: 1px solid #1f2937;
  background: #020617;
  color: #e5e7eb;
  font-size: 1rem;
  font-family: ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;

  &:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 0;
  }
}

.modal__actions {
  display: flex;
  justify-content: flex-end;
}

.loc-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.loc-pill {
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #4b5563;
  background: #0b1223;
  color: #e5e7eb;
  font-size: 0.9rem;
  cursor: pointer;

  &--active {
    background: #3b82f6;
    border-color: #93c5fd;
    color: #0b1223;
    font-weight: 600;
  }

  &:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }
}

</style>
