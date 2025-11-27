<script setup lang="ts">
import { ref } from 'vue'
import { sendScan, type ScanMode, type ScanResponse } from './api'

const scanValue = ref('')
const mode = ref<ScanMode>('IN')
const lastResponse = ref<ScanResponse | null>(null)
const isSubmitting = ref(false)
const error = ref<string | null>(null)

async function onSubmit() {
  if (!scanValue.value || isSubmitting.value) return

  isSubmitting.value = true
  error.value = null

  try {
    const result = await sendScan(scanValue.value, mode.value)
    lastResponse.value = result
    scanValue.value = ''
  } catch (err: any) {
    error.value = err?.message ?? 'Unknown error'
    lastResponse.value = null
  } finally {
    isSubmitting.value = false
  }
}
</script>


<template>
  <div class="app">
    <header class="app__header">
      <h1>PrepperStore</h1>
      <p class="app__subtitle">Simple prepper storage tracker</p>
    </header>

    <main class="app__main">
      <div class="scan">
        <form @submit.prevent="onSubmit" class="scan-form">
          <div class="scan-form__mode">
            <button
              type="button"
              :class="['mode-btn', { 'mode-btn--active': mode === 'IN' }]"
              @click="mode = 'IN'"
            >
              In
            </button>
            <button
              type="button"
              :class="['mode-btn', { 'mode-btn--active': mode === 'OUT' }]"
              @click="mode = 'OUT'"
            >
              Out
            </button>
            <button
              type="button"
              :class="['mode-btn', { 'mode-btn--active': mode === 'STATUS' }]"
              @click="mode = 'STATUS'"
            >
              Status
            </button>
          </div>

          <input
            v-model="scanValue"
            class="scan-form__input"
            type="text"
            autofocus
            autocomplete="off"
            placeholder="Scan or type barcode…"
          />

          <button type="submit" class="scan-form__submit" :disabled="isSubmitting">
            {{ isSubmitting ? 'Working…' : 'Submit' }}
          </button>
        </form>

        <div class="scan-result">
          <p v-if="error" class="status status--error">
            {{ error }}
          </p>

          <template v-else-if="lastResponse">
            <p class="status status--ok">
              Mode: {{ lastResponse.mode }} · Barcode: {{ lastResponse.barcode }}
            </p>

            <div v-if="lastResponse.status === 'unknown_identifier'" class="card">
              <h2>Unknown identifier</h2>
              <p>
                This barcode is not linked to any item yet.
              </p>
              <!-- later: buttons like "Create item" / "Link to existing" -->
            </div>

            <div v-else-if="lastResponse.status === 'known'" class="card">
              <h2>{{ lastResponse.item.name }}</h2>
              <p class="muted">
                Item ID: {{ lastResponse.item.id }}
                <span v-if="lastResponse.item.threshold !== null">
                  · Threshold: {{ lastResponse.item.threshold }}
                </span>
              </p>

              <div v-if="lastResponse.locations.length > 0">
                <h3>Stock per location</h3>
                <ul class="locations">
                  <li v-for="loc in lastResponse.locations" :key="loc.locationId">
                    <span class="loc-name">{{ loc.locationName }}</span>
                    <span class="loc-amount">{{ loc.amount }}</span>
                  </li>
                </ul>
              </div>
              <p v-else class="muted">
                No stock registered yet for this item.
              </p>
            </div>
          </template>
        </div>
      </div>
    </main>
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
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }
}

.scan-form {
  width: 100%;
  max-width: 480px;
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

.status {
  font-size: 0.9rem;

  &--ok {
    color: #22c55e;
  }

  &--error {
    color: #f97316;
  }
}

.scan {
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.scan-result {
  min-height: 120px;
}

.status {
  font-size: 0.9rem;
  margin-bottom: 0.5rem;

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

  li {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
  }

  .loc-name {
    color: #e5e7eb;
  }

  .loc-amount {
    font-variant-numeric: tabular-nums;
  }
}

</style>
