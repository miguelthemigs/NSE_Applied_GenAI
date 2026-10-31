/**
 * Maps a backend `stage:"download"` stream event to ProgressPanel's `download` prop.
 * `tierKey` is the tier the user picked (null for an Advanced id); it wins over the
 * event's tier because Quick and Balanced share one embedding model.
 * Returns null for any other event.
 */
export function downloadFromEvent(event, tierKey = null) {
  if (event?.status !== 'progress' || event.stage !== 'download') return null
  const p = event.params ?? {}
  return {
    bytesDone: Number(p.bytes_done) || 0,
    bytesTotal: p.bytes_total > 0 ? Number(p.bytes_total) : null,
    tierKey: tierKey ?? p.tier ?? null,
  }
}

/** The translated headline for a stream error code; null when the code has no copy. */
export function streamErrorKey(code) {
  if (code === 'error.download_failed') return 'download.failed'
  if (code === 'error.llm_unavailable') return 'error.llm_unavailable'
  return null
}
