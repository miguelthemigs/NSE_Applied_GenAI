import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { PipelineStatusProvider, usePipelineStatus } from './PipelineStatusContext.jsx'
import fresh from '../../e2e/fixtures/status/fresh.json'
import vectorsRunning from '../../e2e/fixtures/status/vectors-running.json'
import allDone from '../../e2e/fixtures/status/all-done.json'

function Probe() {
  const { status, loading, error, refresh } = usePipelineStatus()
  return (
    <>
      <p data-testid="out">
        {loading ? 'loading' : `${status?.steps?.vectors?.state ?? 'none'}|${error ?? 'ok'}`}
      </p>
      <button type="button" onClick={refresh}>refresh</button>
    </>
  )
}

async function clickRefresh() {
  fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const statusCalls = () => fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/pipeline/status')).length

async function mount() {
  render(
    <PipelineStatusProvider>
      <Probe />
    </PipelineStatusProvider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PipelineStatusProvider', () => {
  it('loads the status once on mount and does not poll without an active job', async () => {
    fetch.mockResolvedValue(jsonResponse(fresh))
    await mount()
    expect(screen.getByTestId('out')).toHaveTextContent('blocked|ok')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(statusCalls()).toBe(1)
  })

  it('polls every 2 s while a job is active and stops when it ends', async () => {
    fetch.mockResolvedValue(jsonResponse(vectorsRunning))
    await mount()
    expect(screen.getByTestId('out')).toHaveTextContent('in_progress|ok')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    expect(statusCalls()).toBe(3)

    fetch.mockResolvedValue(jsonResponse(allDone))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(screen.getByTestId('out')).toHaveTextContent('done|ok')
    const after = statusCalls()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(statusCalls()).toBe(after)
  })

  it('a slow poll never overlaps the next one, and its answer is applied', async () => {
    fetch.mockResolvedValue(jsonResponse(vectorsRunning))
    await mount()
    expect(statusCalls()).toBe(1)
    // From now on every status call takes 5 s to answer.
    let inFlight = 0
    let maxInFlight = 0
    fetch.mockImplementation(() => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight -= 1
          resolve(jsonResponse(allDone))
        }, 5_000),
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000) // poll 2 starts
    })
    expect(statusCalls()).toBe(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000) // an interval would have fired twice more by now
    })
    expect(statusCalls()).toBe(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000) // poll 2 answers: job finished
    })
    expect(screen.getByTestId('out')).toHaveTextContent('done|ok')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(statusCalls()).toBe(2)
    expect(maxInFlight).toBe(1)
  })

  it('retries every 5 s while offline and recovers without a reload', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await mount()
    expect(screen.getByTestId('out')).toHaveTextContent('none|offline')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999)
    })
    expect(statusCalls()).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(statusCalls()).toBe(2)
    fetch.mockResolvedValue(jsonResponse(fresh))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByTestId('out')).toHaveTextContent('blocked|ok')
    const after = statusCalls()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(statusCalls()).toBe(after)
  })

  it('refresh() fetches again on demand', async () => {
    fetch.mockResolvedValue(jsonResponse(fresh))
    await mount()
    fetch.mockResolvedValue(jsonResponse(allDone))
    await clickRefresh()
    expect(screen.getByTestId('out')).toHaveTextContent('done|ok')
  })

  it('reports offline but keeps the last good status', async () => {
    fetch.mockResolvedValue(jsonResponse(allDone))
    await mount()
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await clickRefresh()
    expect(screen.getByTestId('out')).toHaveTextContent('done|offline')
  })

  it('reports a failed response without crashing', async () => {
    fetch.mockResolvedValue(jsonResponse({ status: 'error', error: 'boom' }, 500))
    await mount()
    expect(screen.getByTestId('out')).toHaveTextContent('none|failed')
  })

  it('throws a clear error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/PipelineStatusProvider/)
  })
})
