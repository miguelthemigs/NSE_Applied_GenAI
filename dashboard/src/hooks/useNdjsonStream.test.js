import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { readNdjson } from '../services/api'
import { useNdjsonStream } from './useNdjsonStream'

function responseFrom(chunks) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(enc.encode(c)))
      controller.close()
    },
  })
  return new Response(stream)
}

describe('readNdjson', () => {
  it('buffers partial lines across chunks and skips blank lines', async () => {
    const onEvent = vi.fn()
    await readNdjson(responseFrom(['{"a":1}\n{"b"', ':2}\n\n']), onEvent)
    expect(onEvent.mock.calls).toEqual([[{ a: 1 }], [{ b: 2 }]])
  })

  it('parses a final line without a trailing newline', async () => {
    const onEvent = vi.fn()
    await readNdjson(responseFrom(['{"a":1}\n{"b":2}']), onEvent)
    expect(onEvent.mock.calls).toEqual([[{ a: 1 }], [{ b: 2 }]])
  })
})

function neverEndingResponse() {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(enc.encode('{"status":"progress"}\n')) },
  }))
}

describe('readNdjson abort', () => {
  it('rejects with AbortError when the signal aborts mid-stream', async () => {
    const ac = new AbortController()
    const onEvent = vi.fn(() => ac.abort())
    await expect(readNdjson(neverEndingResponse(), onEvent, ac.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
})

describe('useNdjsonStream', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubFetch() {
    let signal
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      signal = init.signal
      return Promise.resolve(neverEndingResponse())
    }))
    return () => signal
  }

  it('does not abort the request on unmount', async () => {
    const getSignal = stubFetch()
    const { result, unmount } = renderHook(() => useNdjsonStream())
    let pending
    await act(async () => { pending = result.current.start('/api/x', {}) })
    await vi.waitFor(() => expect(getSignal()).toBeDefined())
    unmount()
    expect(getSignal().aborted).toBe(false)
    pending.catch(() => {})
  })

  it('cancel() makes start() reject with AbortError', async () => {
    stubFetch()
    const { result } = renderHook(() => useNdjsonStream())
    let outcome
    await act(async () => {
      const onEvent = vi.fn()
      const p = result.current.start('/api/x', {}, { onEvent }).catch((e) => e)
      await vi.waitFor(() => expect(onEvent).toHaveBeenCalled())
      result.current.cancel()
      outcome = await p
    })
    expect(outcome.name).toBe('AbortError')
  })

  it('a non-OK response rejects with its status, code and params', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ status: 'error', code: 'error.blocked', params: { step: 'anonymize' }, error: 'Step 1 is not done' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ))))
    const { result } = renderHook(() => useNdjsonStream())
    let outcome
    await act(async () => { outcome = await result.current.start('/api/build-vectors', {}).catch((e) => e) })
    expect(outcome).toMatchObject({ message: 'Step 1 is not done', status: 409, code: 'error.blocked', params: { step: 'anonymize' } })
  })
})
