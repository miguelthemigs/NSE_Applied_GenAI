import { useEffect, useRef, useState } from 'react'

const MIN_GAIN = 5 // percentage points of progress before an estimate means anything
const MIN_ELAPSED_MS = 5000

/**
 * Seconds remaining, extrapolated from how fast progress has moved since the first
 * non-zero sample. Returns null until there is enough signal; it never guesses.
 * The panel is mounted only while a run is active, so state resets between runs.
 */
export function etaFrom(first, now, progress) {
  if (!first || progress >= 100) return null
  const gain = progress - first.progress
  const elapsed = now - first.at
  if (gain < MIN_GAIN || elapsed < MIN_ELAPSED_MS) return null
  return (elapsed / 1000) * ((100 - progress) / gain)
}

export default function useEta(progress) {
  const first = useRef(null)
  const [eta, setEta] = useState(null)
  useEffect(() => {
    if (!(progress > 0)) return
    const now = Date.now()
    if (!first.current) {
      first.current = { progress, at: now }
      return
    }
    setEta(etaFrom(first.current, now, progress))
  }, [progress])
  return eta
}
