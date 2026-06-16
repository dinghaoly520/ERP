import { ref, watch, onUnmounted, toValue, type Ref, type MaybeRefOrGetter } from 'vue'

const PREFIX = 'supplier_draft:'

interface Blob<T> { v: 1; ts: number; data: T }

export interface UseAutoSaveOptions {
  debounce?: number
  enabled?: MaybeRefOrGetter<boolean>
}

export interface UseAutoSaveReturn<T> {
  lastSavedAt: Ref<number | null>
  storedAt: Ref<number | null>
  hasDraft: Ref<boolean>
  dirty: Ref<boolean>
  restoreDraft: () => T | null
  clearDraft: () => void
  markClean: () => void
}

function readBlob<T>(key: string): Blob<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.ts === 'number' && parsed.data) return parsed as Blob<T>
    return null
  } catch { return null }
}

function writeBlob<T>(key: string, data: T): number {
  const ts = Date.now()
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ v: 1, ts, data })) } catch {}
  return ts
}

function removeBlob(key: string) {
  try { localStorage.removeItem(PREFIX + key) } catch {}
}

export function useAutoSave<T extends object>(
  key: MaybeRefOrGetter<string>,
  source: Ref<T>,
  options: UseAutoSaveOptions = {},
): UseAutoSaveReturn<T> {
  const debounce = options.debounce ?? 800
  const lastSavedAt = ref<number | null>(null)
  const storedAt = ref<number | null>(null)
  const hasDraft = ref(false)
  const dirty = ref(false)

  const existing = readBlob<T>(toValue(key))
  if (existing) { storedAt.value = existing.ts; hasDraft.value = true }

  let timer: ReturnType<typeof setTimeout> | null = null

  function resolveKey() { return toValue(key) }
  function resolveEnabled() { return options.enabled === undefined ? true : toValue(options.enabled) }

  function markClean() { dirty.value = false }
  function clearDraft() {
    removeBlob(resolveKey())
    hasDraft.value = false; storedAt.value = null; dirty.value = false
  }
  function restoreDraft(): T | null {
    const blob = readBlob<T>(resolveKey())
    return blob ? blob.data : null
  }

  watch(source, () => {
    if (!resolveEnabled()) return
    dirty.value = true
    if (timer) clearTimeout(timer)
    const k = resolveKey()
    timer = setTimeout(() => {
      const ts = writeBlob(k, source.value)
      lastSavedAt.value = ts; storedAt.value = ts; hasDraft.value = true
    }, debounce)
  }, { deep: true })

  onUnmounted(() => { if (timer) clearTimeout(timer) })

  return { lastSavedAt, storedAt, hasDraft, dirty, restoreDraft, clearDraft, markClean }
}
