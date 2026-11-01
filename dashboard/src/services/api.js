/**
 * Single API client for the NSE pipeline backend (Flask, port 5001).
 * Every network call in the dashboard builds its URL through apiUrl().
 */

import { filtersToLegacyApiParams } from '../utils/filters'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5001'

/** Thrown when the backend cannot be reached at all (network failure). */
export class OfflineError extends Error {
  constructor(cause) {
    super('Backend offline')
    this.name = 'OfflineError'
    this.cause = cause
  }
}

export function apiUrl(path) {
  return `${API_BASE}${path}`
}

async function request(path, init) {
  let res
  try {
    res = await fetch(apiUrl(path), init)
  } catch (e) {
    throw new OfflineError(e)
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data }
}

/** GET JSON. Never throws on HTTP errors; throws OfflineError on network failure. */
export function getJson(path) {
  return request(path)
}

/** POST JSON. Same result shape and error behaviour as getJson. */
export function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/**
 * Read an NDJSON response body, calling onEvent(obj) for each complete line.
 * Partial lines are buffered across chunks; blank lines are skipped; a final
 * line without a trailing newline is parsed when the stream ends.
 * Rejects with an AbortError when the signal aborts.
 */
export async function readNdjson(response, onEvent, signal) {
  if (!response.body) throw new Error('Response has no readable body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flushLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      console.error('Failed to parse NDJSON line', trimmed)
      return
    }
    onEvent(obj)
  }
  const abortError = () => new DOMException('The stream was cancelled', 'AbortError')
  const onAbort = () => reader.cancel().catch(() => {})
  if (signal?.aborted) {
    onAbort()
    throw abortError()
  }
  signal?.addEventListener('abort', onAbort)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (signal?.aborted) throw abortError()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      lines.forEach(flushLine)
    }
    buffer += decoder.decode()
    flushLine(buffer)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

// ── Legacy /api/v1 helpers (used only by useApiData / Vergelijken) ───────────
// Dead code: the /api/v1 FastAPI does not exist; kept so Vergelijken still builds.
const LEGACY_BASE = '/api/v1'
const TIMEOUT_MS = 5_000

async function apiFetch(path, params = {}) {
  const url = new URL(LEGACY_BASE + path, window.location.origin)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined) url.searchParams.set(k, String(v))
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ── Filter conversion: dashboard filters → API query params ──────────────────
export function filtersToParams(filters = {}) {
  return filtersToLegacyApiParams(filters)
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns theme frequency stats, or null on failure. */
export async function fetchThemes(filters = {}) {
  try { return await apiFetch('/themes/', filtersToParams(filters)) }
  catch { return null }
}

/** Returns comparison data grouped by programme/location/mode, or null on failure. */
export async function fetchCompare(filters = {}, groupBy = 'programme') {
  try {
    return await apiFetch('/compare/', { ...filtersToParams(filters), group_by: groupBy })
  } catch { return null }
}

/** Returns true if the backend is reachable. */
export async function checkHealth() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3_000)
    const res = await fetch('/health', { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch { return false }
}
