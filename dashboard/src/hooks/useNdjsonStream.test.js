import { describe, it, expect, vi } from 'vitest'
import { readNdjson } from '../services/api'

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
