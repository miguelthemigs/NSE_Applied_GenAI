import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl, OfflineError, readNdjson } from '../services/api'

/**
 * POST to an NDJSON endpoint and track the events as they arrive.
 * start(path, body, {onEvent}) resolves with the last event (or null).
 * It rejects on network failure, a non-OK response (message from the JSON body), or cancellation (AbortError).
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

  useEffect(() => () => controllerRef.current?.abort(), [])

  const start = useCallback(async (path, body, { onEvent } = {}) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setEvents([])
    setLast(null)
    setError(null)
    setRunning(true)
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
        try {
          const data = await response.json()
          message = data.message || data.error || message
        } catch {
          // body was not JSON; keep the generic message
        }
        throw new Error(message)
      }
      await readNdjson(response, (evt) => {
        lastEvent = evt
        setEvents((prev) => [...prev, evt])
        setLast(evt)
        onEvent?.(evt)
      }, controller.signal)
      return lastEvent
    } catch (e) {
      if (controllerRef.current === controller) setError(e)
      throw e
    } finally {
      if (controllerRef.current === controller) setRunning(false)
    }
  }, [])

  return { start, events, last, running, error, cancel }
}
