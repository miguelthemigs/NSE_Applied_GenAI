import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider.jsx'
import { PipelineStatusProvider } from '../context/PipelineStatusContext.jsx'
import AnonymizerTab from './AnonymizerTab.jsx'
import anonDone from '../../e2e/fixtures/status/anon-done.json'
import needsReview from '../../e2e/fixtures/status/anon-needs-review.json'

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const MISS = '[MOGELIJKE NAAM]'
const REPORT = {
  has_report: true,
  timestamp: '2026-10-31T14:12:00',
  rows_processed: 300,
  total_entities: 409,
  tag_counts: { NAME: 288 },
  missed_counts: { NAME: 1 },
  missed_samples: { NAME: [MISS] },
}

let reportHandler
function mockBackend(status) {
  fetch.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname
    if (path === '/api/pipeline/status') return jsonResponse(status)
    if (path === '/api/anonymize-report') return reportHandler()
    if (path === '/api/checkpoint-status') return jsonResponse({ has_checkpoint: false })
    if (path === '/api/word-blocklist') return jsonResponse({ words: [] })
    return jsonResponse({}, 404)
  })
}

function renderTab() {
  render(
    <I18nProvider>
      <MemoryRouter>
        <PipelineStatusProvider>
          <AnonymizerTab onNavigate={vi.fn()} />
        </PipelineStatusProvider>
      </MemoryRouter>
    </I18nProvider>,
  )
}

const ACK = 'Ik heb de mogelijke missers bekeken'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
  reportHandler = () => jsonResponse(REPORT)
})
afterEach(() => vi.unstubAllGlobals())

describe('AnonymizerTab', () => {
  it('shows no Done card while step 1 runs (view.state is in_progress), even if the raw state still says done', async () => {
    const running = structuredClone(anonDone)
    running.active_job = { step: 'anonymize', stage: 'process', progress: 10 }
    mockBackend(running)
    renderTab()
    // the status has loaded: the existing-dataset card depends on it
    expect(await screen.findByText('Er is al een geanonimiseerde dataset beschikbaar.')).toBeVisible()
    expect(screen.queryByText(/^Klaar\. 300 antwoorden gecontroleerd/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Opnieuw uitvoeren' })).toBeNull()
  })

  it('needs review while the miss list never arrives: the box stays disabled and a loading state shows', async () => {
    reportHandler = () => new Promise(() => {})
    mockBackend(needsReview)
    renderTab()
    const box = await screen.findByRole('checkbox', { name: ACK })
    expect(box).toBeDisabled()
    expect(screen.getByText('Laden…')).toBeVisible()
    expect(screen.queryByText('Geen voorbeelden beschikbaar.')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(box).toBeDisabled()
  })

  it('needs review when the miss list fails to load: an error with retry, and the box stays disabled until it loads', async () => {
    reportHandler = () => jsonResponse({ error: 'boom' }, 500)
    mockBackend(needsReview)
    renderTab()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('De lijst met mogelijke missers kon niet worden geladen.')
    expect(screen.getByRole('checkbox', { name: ACK })).toBeDisabled()
    expect(screen.queryByText('Geen voorbeelden beschikbaar.')).toBeNull()

    reportHandler = () => jsonResponse(REPORT)
    await userEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }))
    expect(await screen.findByText(MISS)).toBeVisible()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: ACK })).toBeEnabled())
  })

  it('a report for a different run than the status names counts as not loaded', async () => {
    reportHandler = () => jsonResponse({ ...REPORT, timestamp: '2026-10-30T09:00:00' })
    mockBackend(needsReview)
    renderTab()
    expect(await screen.findByRole('alert')).toHaveTextContent('De lijst met mogelijke missers kon niet worden geladen.')
    expect(screen.getByRole('checkbox', { name: ACK })).toBeDisabled()
    expect(screen.queryByText(MISS)).toBeNull()
  })
})
