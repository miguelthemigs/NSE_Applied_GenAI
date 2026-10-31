import { downloadFromEvent, streamErrorKey } from './downloadProgress'

describe('downloadFromEvent', () => {
  const event = (params) => ({ status: 'progress', stage: 'download', params })

  it('maps bytes and the event tier', () => {
    expect(downloadFromEvent(event({ bytes_done: 4e8, bytes_total: 1.2e9, tier: 'quick' }))).toEqual({ bytesDone: 4e8, bytesTotal: 1.2e9, tierKey: 'quick' })
  })

  it('prefers the tier the user picked (Quick and Balanced share an embedding model)', () => {
    expect(downloadFromEvent(event({ bytes_done: 1, bytes_total: 2, tier: 'balanced' }), 'quick').tierKey).toBe('quick')
  })

  it('treats a missing or zero total as unknown', () => {
    expect(downloadFromEvent(event({ bytes_done: 5, bytes_total: null, tier: null })).bytesTotal).toBeNull()
    expect(downloadFromEvent(event({ bytes_done: 5, bytes_total: 0 })).bytesTotal).toBeNull()
  })

  it('is null for any other event, so the panel switches to the next stage', () => {
    expect(downloadFromEvent({ status: 'progress', stage: 'load', progress: 20 })).toBeNull()
    expect(downloadFromEvent({ status: 'success' })).toBeNull()
    expect(downloadFromEvent(null)).toBeNull()
  })
})

describe('streamErrorKey', () => {
  it('translates the download and LLM codes only', () => {
    expect(streamErrorKey('error.download_failed')).toBe('download.failed')
    expect(streamErrorKey('error.llm_unavailable')).toBe('error.llm_unavailable')
    expect(streamErrorKey('error.backend')).toBeNull()
  })
})
