import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../../../i18n/I18nProvider.jsx'
import { PipelineStatusProvider } from '../../../context/PipelineStatusContext.jsx'
import WriteSummaries from './WriteSummaries.jsx'
import ResultsList from './ResultsList.jsx'
import allDone from '../../../../e2e/fixtures/status/all-done.json'

const BALANCED = 'unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL'
const RUN = 'Samenvattingen schrijven'
const CLEAR = 'Opgeslagen samenvattingen wissen'

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
function ndjson(events) {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) {
      events.forEach((e) => c.enqueue(enc.encode(JSON.stringify(e) + '\n')))
      c.close()
    },
  }))
}

const notStarted = structuredClone(allDone)
notStarted.steps.insights = { state: 'not_started', completed_at: null, summary: null }

const RESULTS = {
  rows: [
    { kind: 'main', done: 3, total: 7, state: 'partial' },
    { kind: 'sub', done: 0, total: null, state: 'not_started' },
    { kind: 'filtered', done: 0, total: 0, state: 'off' },
  ],
  estimate: null,
}

let routes
function mockBackend(overrides = {}) {
  routes = {
    'GET /api/pipeline/status': () => jsonResponse(notStarted),
    'GET /api/insights/results': () => jsonResponse(RESULTS),
    'POST /api/precompute-preview': () => jsonResponse({ valid_combos: 0, estimate: null }),
    'POST /api/llm-models/start-stream': () => ndjson([{ status: 'progress', stage: 'load' }, { status: 'success' }]),
    'POST /api/precompute-insights': () => ndjson([{ status: 'progress', stage: 'process', progress: 50 }, { status: 'success', progress: 100 }]),
    'POST /api/clear-cache': () => jsonResponse({ status: 'success' }),
    'POST /api/clear-subtheme-cache': () => jsonResponse({ status: 'success' }),
    ...overrides,
  }
  fetch.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname
    const handler = routes[`${init?.method ?? 'GET'} ${path}`]
    return handler ? handler(init) : jsonResponse({}, 404)
  })
}

const calls = (method, path) =>
  fetch.mock.calls.filter(([url, init]) => new URL(String(url)).pathname === path && (init?.method ?? 'GET') === method)

function renderStep() {
  render(
    <I18nProvider>
      <MemoryRouter>
        <PipelineStatusProvider>
          <WriteSummaries onNavigate={vi.fn()} />
        </PipelineStatusProvider>
      </MemoryRouter>
    </I18nProvider>,
  )
}

const runButton = () => screen.findByRole('button', { name: RUN })

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WriteSummaries', () => {
  it('one click starts the model, then POSTs the precompute body', async () => {
    mockBackend()
    renderStep()
    const button = await runButton()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    await waitFor(() => expect(calls('POST', '/api/precompute-insights')).toHaveLength(1))
    expect(calls('POST', '/api/llm-models/start-stream')).toHaveLength(1)
    const body = JSON.parse(calls('POST', '/api/precompute-insights')[0][1].body)
    expect(body).toEqual({ precache_subthemes: true, filter_dimensions: [], model_id: BALANCED, max_documents: 240 })
  })

  it('above 500 summaries asks insights.confirmLarge and sends nothing until confirmed', async () => {
    mockBackend({
      'POST /api/precompute-preview': () => jsonResponse({ valid_combos: 86, estimate: { count: 600, minutes: 900 } }),
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderStep()
    const button = await runButton()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(screen.getByRole('checkbox', { name: /elke combinatie van jaar, locatie en opleiding/ }))
    expect(await screen.findByText(/600 samenvattingen, ongeveer 900 min/)).toBeVisible()

    await userEvent.click(button)
    expect(confirm).toHaveBeenCalledWith('Dit zijn 600 samenvattingen en duurt ongeveer 15 uur. Doorgaan?')
    expect(calls('POST', '/api/precompute-insights')).toHaveLength(0)
    expect(calls('POST', '/api/llm-models/start-stream')).toHaveLength(0)

    confirm.mockReturnValue(true)
    await userEvent.click(button)
    await waitFor(() => expect(calls('POST', '/api/precompute-insights')).toHaveLength(1))
    const body = JSON.parse(calls('POST', '/api/precompute-insights')[0][1].body)
    expect(body.filter_dimensions).toEqual(['academic_year', 'location', 'programme'])
  })

  it('a start-stream error shows the translated message and never POSTs precompute', async () => {
    mockBackend({
      'POST /api/llm-models/start-stream': () => ndjson([{ status: 'error', code: 'error.llm_unavailable', error: 'exited early' }]),
    })
    renderStep()
    const button = await runButton()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(await screen.findByText('Het AI-model kon niet worden gestart. Probeer het opnieuw; lukt het niet, start de app opnieuw.')).toBeVisible()
    expect(calls('POST', '/api/precompute-insights')).toHaveLength(0)
  })

  it('the clear-cache control asks insights.clearCache.confirm; cancelling sends no request', async () => {
    mockBackend()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderStep()
    await runButton()
    const advanced = screen.getAllByText('Geavanceerd').map((s) => s.closest('details')).find((d) => within(d).queryByRole('button', { name: CLEAR }))
    await userEvent.click(within(advanced).getByText('Geavanceerd'))
    await userEvent.click(within(advanced).getByRole('button', { name: CLEAR }))
    expect(confirm).toHaveBeenCalledWith('Weet je het zeker? Alle samenvattingen worden verwijderd.')
    expect(calls('POST', '/api/clear-cache')).toHaveLength(0)
    expect(calls('POST', '/api/clear-subtheme-cache')).toHaveLength(0)

    confirm.mockReturnValue(true)
    await userEvent.click(within(advanced).getByRole('button', { name: CLEAR }))
    await waitFor(() => expect(calls('POST', '/api/clear-cache')).toHaveLength(1))
    expect(calls('POST', '/api/clear-subtheme-cache')).toHaveLength(1)
  })

  it('the clear-cache control lives only inside the collapsed Advanced disclosure', async () => {
    mockBackend()
    renderStep()
    await runButton()
    const clear = screen.getByRole('button', { name: CLEAR, hidden: true })
    const details = clear.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(details.querySelector('summary')).toHaveTextContent('Geavanceerd')
    expect(clear).not.toBeVisible()
    expect(screen.getAllByRole('button', { name: CLEAR, hidden: true })).toHaveLength(1)
  })

  it('has exactly one primary run button and none of the old four', async () => {
    mockBackend()
    renderStep()
    await runButton()
    expect(screen.getAllByRole('button', { name: RUN })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Thema's samenvatten|Subthema's samenvatten/ })).toBeNull()
  })
})

describe('ResultsList', () => {
  const renderList = (dims) =>
    render(
      <I18nProvider>
        <MemoryRouter>
          <PipelineStatusProvider>
            <ResultsList filterDimensions={dims} />
          </PipelineStatusProvider>
        </MemoryRouter>
      </I18nProvider>,
    )

  it("renders t('state.off') for the filtered row when the box is unticked", async () => {
    mockBackend()
    renderList([])
    const row = (await screen.findByText('Per jaar, locatie en opleiding')).closest('li')
    expect(within(row).getByText('Uit')).toBeVisible()
    expect(within(row).getByText('—')).toBeVisible()
  })

  it('shows the backend rows, and min(done, total) for the filtered row', async () => {
    mockBackend({
      'GET /api/insights/results': () => jsonResponse({
        rows: [
          { kind: 'main', done: 3, total: 7, state: 'partial' },
          { kind: 'sub', done: 12, total: null, state: 'done' },
          { kind: 'filtered', done: 130, total: 126, state: 'done' },
        ],
        estimate: { count: 126, minutes: 189 },
      }),
    })
    renderList(['academic_year', 'location', 'programme'])
    const main = (await screen.findByText('3 / 7')).closest('li')
    expect(within(main).getByText('Deels klaar (3 van 7)')).toBeVisible()
    expect(screen.getByText('12')).toBeVisible()
    expect(screen.getByText('126 / 126')).toBeVisible()
    const url = new URL(String(calls('GET', '/api/insights/results').at(-1)[0]))
    expect(url.searchParams.get('filter_dimensions')).toBe('academic_year,location,programme')
  })
})
