import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl, OfflineError, readNdjson } from '../services/api'

/**
 * POST to an NDJSON endpoint and track the events as they arrive.
 * start(path, body, {onEvent}) resolves with the last event (or null).
 * It rejects on network failure, a non-OK response (message from the JSON body; the
 * error also carries the HTTP `status` and the body's `code` / `params`), or
 * cancellation (AbortError).
 */
export function useNdjsonStream() {
  const [events, setEvents] = useState([])
  const [last, setLast] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const controllerRef = useRef(null)

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  // Unmounting must not close the connection (that would kill the server-side
  // run); it only stops state updates. Only cancel() aborts.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const start = useCallback(async (path, body, { onEvent } = {}) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    if (mountedRef.current) {
      setEvents([])
      setLast(null)
      setError(null)
      setRunning(true)
    }
    let lastEvent = null
    try {
      let response
      try {
        response = await fetch(apiUrl(path), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (e) {
        if (e?.name === 'AbortError') throw e
        throw new OfflineError(e)
      }
      if (!response.ok) {
        let message = `Request failed with HTTP ${response.status}`
        let data = null
        try {
          data = await response.json()
          message = data.message || data.error || message
        } catch {
          // body was not JSON; keep the generic message
        }
        const err = new Error(message)
        err.status = response.status
        err.code = data?.code ?? null
        err.params = data?.params ?? null
        throw err
      }
      await readNdjson(response, (evt) => {
        lastEvent = evt
        if (mountedRef.current) {
          setEvents((prev) => [...prev, evt])
          setLast(evt)
        }
        onEvent?.(evt)
      }, controller.signal)
      return lastEvent
    } catch (e) {
      if (mountedRef.current && controllerRef.current === controller) setError(e)
      throw e
    } finally {
      if (mountedRef.current && controllerRef.current === controller) setRunning(false)
    }
  }, [])

  return { start, events, last, running, error, cancel }
}
