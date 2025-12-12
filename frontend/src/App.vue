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
  }
})

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
      <h1>PrepperStore</h1>
      <p class="app__subtitle">Simpel prepper lagerstyring</p>
    </header>

    <main class="app__main">
      <div v-if="authLoading" class="card login-card">
        Logger ind…
      </div>

      <div v-else-if="!isAuthenticated" class="card login-card">
        <h2>Login</h2>
        <p class="muted">Indtast adgangskoden for at fortsætte.</p>
        <form @submit.prevent="onLoginSubmit" class="login-form">
          <input
            v-model="loginPassword"
            ref="loginInputRef"
            type="password"
            class="scan-form__input"
            placeholder="Adgangskode"
          />
          <button type="submit" class="scan-form__submit">Log ind</button>
          <p v-if="loginError" class="status status--error">{{ loginError }}</p>
        </form>
      </div>

      <div v-else class="scan">
        <div class="scan__controls">
          <p class="current-status">
            Tilstand: {{ mode }}
            <span v-if="selectedLocationName">
              · Lokation: {{ selectedLocationName }}
            </span>
          </p>

          <form @submit.prevent="onSubmit" class="scan-form">
            <div class="scan-form__mode">
              <button type="button" :class="['mode-btn', { 'mode-btn--active': mode === 'IN' }]" @click="setMode('IN')">
                Ind
              </button>
              <button type="button" :class="['mode-btn', { 'mode-btn--active': mode === 'OUT' }]" @click="setMode('OUT')">
                Ud
              </button>
              <button type="button" :class="['mode-btn', { 'mode-btn--active': mode === 'STATUS' }]"
                @click="setMode('STATUS')">
                Status
              </button>
            </div>
            <div class="location-buttons">
              <button type="button" :class="['loc-btn', { 'loc-btn--active': selectedLocationId === 1 }]"
                @click="setLocation(1, 'Viktualierum')">
                Viktualierum
              </button>
              <button type="button" :class="['loc-btn', { 'loc-btn--active': selectedLocationId === 2 }]"
                @click="setLocation(2, 'Kontor')">
                Kontor
              </button>
              <button type="button" :class="['loc-btn', { 'loc-btn--active': selectedLocationId === 3 }]"
                @click="setLocation(3, 'Kummefryser')">
                Kummefryser
              </button>
            </div>


            <input v-model="scanValue" ref="scanInput" class="scan-form__input" type="text" autofocus autocomplete="off"
              placeholder="Scan eller indtast stregkode…" :disabled="scanLocked" />

            <button type="submit" class="scan-form__submit" :disabled="isSubmitting">
              {{ isSubmitting ? 'Arbejder…' : 'Send' }}
            </button>
          </form>
        </div>

        <div class="scan__output">
          <div class="card scan-result">
            <p v-if="error" class="status status--error">
              {{ error }}
            </p>

            <template v-else-if="lastResponse">
              <p class="status status--ok">
                Tilstand: {{ lastResponse.mode }} · Stregkode: {{ lastResponse.barcode }}
              </p>

              <div v-if="lastResponse.status === 'unknown_identifier'">
                <h2>Ukendt identifikator</h2>
                <div v-if="mode !== 'IN'">
                  <p>
                    Denne stregkode er endnu ikke knyttet til et produkt.
                  </p>
                </div>
                <div v-else>
                  <p class="muted">Ukendt identifikator (se dialogen).</p>
                </div>
              </div>

              <div v-else-if="lastResponse.status === 'known'">
                <h2>{{ lastResponse.item.name }}</h2>
                <p class="muted">
                  Vare-ID: {{ lastResponse.item.id }}
                  <span v-if="lastResponse.item.threshold !== null">
                    · Tærskel: {{ lastResponse.item.threshold }}
                  </span>
                </p>

                <!-- Change summary (OUT mode) -->
                <div v-if="lastResponse.change" class="change">
                  <p v-if="lastResponse.change.action === 'OUT'">
                    <strong>Ændring:</strong>
                    Tog {{ lastResponse.change.quantity }} fra
                    "{{ lastResponse.change.locationName }}"
                    ({{ lastResponse.change.previousAmount }} → {{ lastResponse.change.newAmount }}).
                  </p>
                  <p v-else-if="lastResponse.change.action === 'IN'">
                    <strong>Ændring:</strong>
                    Tilføjede 1 til "{{ lastResponse.change.locationName }}"
                    ({{ lastResponse.change.previousAmount }} → {{ lastResponse.change.newAmount }}).
                  </p>
                </div>

                <p v-else-if="lastResponse.warning === 'no_stock_available'" class="status status--error">
                  Ingen lager tilgængeligt at tage ud.
                </p>
                <p v-else-if="lastResponse.warning === 'no_stock_in_selected_location'" class="status status--error">
                  Ingen lager tilgængeligt i den valgte lokation.
                </p>
                <p v-else-if="lastResponse.warning === 'no_location_selected_for_in'" class="status status--error">
                  Vælg en lokation før du scanner IND.
                </p>

                <!-- Stock per location -->
                <div v-if="lastResponse.locations.length > 0">
                  <h3>Lager pr. lokation</h3>
                  <ul class="locations">
                  <li v-for="loc in lastResponse.locations" :key="loc.locationId" class="loc-row">
                    <span class="loc-name">{{ loc.locationName }}</span>
                    <div class="loc-controls">
                      <button type="button" class="loc-btn--tiny" @click="adjustLocation(loc, -1)">-</button>
                      <span class="loc-amount">{{ loc.amount }}</span>
                      <button type="button" class="loc-btn--tiny" @click="adjustLocation(loc, +1)">+</button>
                    </div>
                  </li>
                  </ul>
                </div>
                <p v-else class="muted">
                  Intet lager registreret endnu for denne vare.
                </p>
              </div>
            </template>

            <p v-else class="muted">
              Scan en stregkode for at se resultater.
            </p>
          </div>
        </div>
      </div>
    </main>

    <div v-if="isAuthenticated && showUnknownInModal" class="modal-backdrop">
      <div class="modal">
        <button type="button" class="modal-close" @click="cancelUnknownIn">
          Luk
        </button>
        <h2>Ukendt identifikator</h2>
        <p>
          Denne stregkode er ikke knyttet til nogen vare i IND-tilstand. Opret en ny vare eller link til en eksisterende, så tilføjer vi den automatisk her.
        </p>
        <p v-if="unknownInError" class="status status--error">
          {{ unknownInError }}
        </p>
        <div class="modal-location">
          <p class="muted">Vælg lokation for denne IN-handling:</p>
          <div class="location-buttons">
            <button
              type="button"
              :class="['loc-btn', { 'loc-btn--active': selectedLocationId === 1 }]"
              @click="setLocation(1, 'Viktualierum')"
            >
              Viktualierum
            </button>
            <button
              type="button"
              :class="['loc-btn', { 'loc-btn--active': selectedLocationId === 2 }]"
              @click="setLocation(2, 'Kontor')"
            >
              Kontor
            </button>
            <button
              type="button"
              :class="['loc-btn', { 'loc-btn--active': selectedLocationId === 3 }]"
              @click="setLocation(3, 'Kummefryser')"
            >
              Kummefryser
            </button>
          </div>
        </div>

        <div class="unknown-panel">
          <div class="unknown-section">
            <h3>Opret ny vare</h3>
            <input
              v-model="newItemName"
              type="text"
              class="scan-form__input"
              placeholder="Varenavn"
            />
            <ul v-if="matchingItems.length > 0" class="suggestions">
              <li
                v-for="(item, index) in matchingItems"
                :key="item.id"
                :class="['suggestion', { 'suggestion--active': index === highlightedIndex }]"
                @click="resolveUnknownByLink(item)"
              >
                {{ item.name }}
              </li>
            </ul>
            <input
              v-model.number="newItemThreshold"
              type="number"
              class="scan-form__input"
              placeholder="Tærskel (valgfrit)"
            />
            <button
              type="button"
              class="scan-form__submit"
              @click="resolveUnknownByCreate"
            >
              Opret vare og tilføj her
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0f172a;
  color: #e5e7eb;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  &__header {
    padding: 1.5rem 1.5rem 0.5rem;
  }

  &__subtitle {
    margin-top: 0.25rem;
    color: #9ca3af;
    font-size: 0.9rem;
  }

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 1.5rem;
  }
}

.scan-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;

  &__mode {
    display: flex;
    gap: 0.5rem;
  }

  &__input {
    padding: 0.85rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid #1f2937;
    background: #020617;
    color: inherit;
    font-size: 1.1rem;

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

.mode-btn {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #1f2937;
  background: #020617;
  color: #9ca3af;
  font-size: 0.9rem;
  cursor: pointer;

  &--active {
    background: #22c55e;
    border-color: #16a34a;
    color: #022c22;
    font-weight: 600;
  }
}

.scan {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.scan__controls {
  width: 100%;
  padding: 1rem 1.25rem;
  border: 1px solid #1f2937;
  border-radius: 0.75rem;
  background: #0b1223;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.scan__output {
  width: 100%;
}

.scan-result {
  min-height: 220px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
  max-width: 420px;
  width: 100%;
  margin-top: 2rem;
  text-align: center;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.5rem;

  .scan-form__input {
    text-align: center;
  }

  .scan-form__submit {
    width: 100%;
  }
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
}

/* these were mistakenly nested inside .locations before */

.change {
  margin: 0.5rem 0 0.75rem;

  p {
    margin: 0;
    font-size: 0.9rem;
  }
}

.current-status {
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
  color: #9ca3af;
}

.location-buttons {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.loc-btn {
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #4b5563;
  background: #020617;
  color: #e5e7eb;
  font-size: 0.85rem;
  cursor: pointer;

  &--active {
    background: #4b5563;
    border-color: #e5e7eb;
  }
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
  max-width: 520px;
  padding: 1.25rem 1.5rem;
  border-radius: 0.75rem;
  background: #020617;
  border: 1px solid #1f2937;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  position: relative;

  h2 {
    margin: 0 0 0.35rem;
  }

  h3 {
    margin: 0;
  }

  p {
    margin: 0 0 0.5rem;
  }
}

.modal-location {
  margin: 0.25rem 0 0.75rem;
}

.modal-close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
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

</style>
