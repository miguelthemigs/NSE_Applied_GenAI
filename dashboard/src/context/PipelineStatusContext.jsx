import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getJson, OfflineError } from '../services/api'

const STATUS_PATH = '/api/pipeline/status'
const POLL_MS = 2000
const OFFLINE_RETRY_MS = 5000

const PipelineStatusContext = createContext(null)

/**
 * Holds GET /api/pipeline/status, the single source of truth for step state.
 * It loads once on mount, polls every 2 s while a job is active, retries every
 * 5 s while the backend is offline, and steps call refresh() whenever one of
 * their streams ends (success, error or abort). The next poll is scheduled only
 * after the previous response, so a slow status call never piles up requests.
 * error is null, 'offline' (backend unreachable) or 'failed' (bad response);
 * the last good status is kept when a refresh fails.
 * refresh() resolves with {status, error}: status is the fetched status or
 * undefined when the request failed. applyStatus(payload) uses a status that
 * another endpoint returned (e.g. acknowledge-review); it returns false when
 * the payload is not a valid status.
 */
export function PipelineStatusProvider({ children }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const seqRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current
    let next = { error: 'failed' }
    try {
      const res = await getJson(STATUS_PATH)
      if (res.ok && res.data?.status === 'success' && res.data.steps) next = { status: res.data, error: null }
    } catch (e) {
      next = { error: e instanceof OfflineError ? 'offline' : 'failed' }
    }
    // Only the newest request may write, so a slow older response can't win.
    if (!mountedRef.current || seq !== seqRef.current) return next
    if (next.status) setStatus(next.status)
    setError(next.error)
    setLoading(false)
    return next
  }, [])

  const applyStatus = useCallback((payload) => {
    if (payload?.status !== 'success' || !payload.steps) return false
    ++seqRef.current // an older in-flight refresh must not overwrite this
    setStatus(payload)
    setError(null)
    setLoading(false)
    return true
  }, [])

  useEffect(() => {
    // refresh() only sets state after its request resolves, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  const pollMs = status?.active_job ? POLL_MS : error === 'offline' ? OFFLINE_RETRY_MS : null
  useEffect(() => {
    if (!pollMs) return undefined
    let cancelled = false
    let timer
    const tick = async () => {
      await refresh()
      if (!cancelled) timer = setTimeout(tick, pollMs)
    }
    timer = setTimeout(tick, pollMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pollMs, refresh])

  const value = useMemo(() => ({ status, loading, error, refresh, applyStatus }), [status, loading, error, refresh, applyStatus])
  return <PipelineStatusContext.Provider value={value}>{children}</PipelineStatusContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePipelineStatus() {
  const ctx = useContext(PipelineStatusContext)
  if (!ctx) throw new Error('usePipelineStatus must be used inside <PipelineStatusProvider>')
  return ctx
}
