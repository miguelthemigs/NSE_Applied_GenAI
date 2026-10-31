import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../../i18n/I18nProvider.jsx'
import { PipelineStatusProvider, usePipelineStatus } from '../../context/PipelineStatusContext.jsx'
import { deriveStepView } from '../../utils/stepView'
import DoneCard from './DoneCard.jsx'
import needsReview from '../../../e2e/fixtures/status/anon-needs-review.json'
import unverified from '../../../e2e/fixtures/status/anon-unverified.json'
import allDone from '../../../e2e/fixtures/status/all-done.json'

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const clone = (o) => structuredClone(o)

function acknowledged(status) {
  const next = clone(status)
  next.steps.anonymize.state = 'done'
  next.steps.anonymize.summary.acknowledged = true
  next.steps.vectors.state = 'not_started'
  return next
}

let server
function mockBackend(initial, onAck) {
  server = { status: clone(initial), statusCalls: 0, ackBodies: [] }
  fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/api/pipeline/status')) {
      server.statusCalls += 1
      return jsonResponse(server.status)
    }
    if (String(url).endsWith('/api/pipeline/acknowledge-review')) {
      const body = JSON.parse(init.body)
      server.ackBodies.push(body)
      return onAck(body)
    }
    return jsonResponse({}, 404)
  })
}

function Harness({ stepId, children, ...props }) {
  const { status } = usePipelineStatus()
  if (!status) return null
  const step = status.steps[stepId]
  return (
    <DoneCard stepId={stepId} stepView={deriveStepView(status, stepId)} summary={step.summary} completedAt={step.completed_at} {...props}>
      {children}
    </DoneCard>
  )
}

function renderCard(stepId, props = {}, children = null) {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <PipelineStatusProvider>
          <Harness stepId={stepId} {...props}>{children}</Harness>
        </PipelineStatusProvider>
      </MemoryRouter>
    </I18nProvider>,
  )
}

const MISSES = <ul><li>[MOGELIJKE NAAM] reageerde nooit</li></ul>

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('DoneCard: anonymize needs_review (the review gate)', () => {
  it('shows the possibly-missed list and keeps Continue disabled with a reason', async () => {
    mockBackend(needsReview, () => jsonResponse({}))
    renderCard('anonymize', { onContinue: vi.fn() }, MISSES)
    expect(await screen.findByText('[MOGELIJKE NAAM] reageerde nooit')).toBeVisible()
    expect(screen.getByText('Mogelijk gemist (1)')).toBeVisible()
    expect(screen.getByText('Klaar. 300 antwoorden gecontroleerd, 409 persoonsgegevens verwijderd, 1 om na te kijken.')).toBeVisible()
    const cont = screen.getByRole('button', { name: 'Verder naar stap 2' })
    expect(cont).toBeDisabled()
    expect(cont).toHaveAccessibleDescription('Vink eerst aan dat je de mogelijke missers hebt bekeken.')
    expect(screen.getByRole('checkbox', { name: 'Ik heb de mogelijke missers bekeken' })).not.toBeChecked()
  })

  it('shows the by_type tiles', async () => {
    mockBackend(needsReview, () => jsonResponse({}))
    renderCard('anonymize', {}, MISSES)
    expect(await screen.findByText('Namen')).toBeVisible()
    expect(screen.getByText('288')).toBeVisible()
    expect(screen.getByText('Locaties')).toBeVisible()
    expect(screen.getByText('Persoonlijke nummers')).toBeVisible()
    expect(screen.getByText('Gezondheid')).toBeVisible()
    expect(screen.getByText('32')).toBeVisible()
  })

  it('ticking the box POSTs the report id, disables the box in flight, and enables Continue after refresh', async () => {
    let release
    mockBackend(needsReview, () => new Promise((resolve) => { release = resolve }))
    const onContinue = vi.fn()
    renderCard('anonymize', { onContinue }, MISSES)
    const box = await screen.findByRole('checkbox', { name: 'Ik heb de mogelijke missers bekeken' })
    await userEvent.click(box)

    expect(server.ackBodies).toEqual([{ report_id: '2026-10-31T14:12:00' }])
    expect(box).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Verder naar stap 2' })).toBeDisabled()

    const callsBefore = server.statusCalls
    server.status = acknowledged(needsReview)
    release(jsonResponse(server.status))

    const cont = screen.getByRole('button', { name: 'Verder naar stap 2' })
    await waitFor(() => expect(cont).toBeEnabled())
    expect(server.statusCalls).toBeGreaterThan(callsBefore)
    expect(box).toBeChecked()
    // the list stays visible after acknowledging
    expect(screen.getByText('[MOGELIJKE NAAM] reageerde nooit')).toBeVisible()
    await userEvent.click(cont)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('a stale report (409) unticks the box, explains it and refreshes to the newer report', async () => {
    const newer = clone(needsReview)
    newer.steps.anonymize.summary.report_id = '2026-10-31T15:00:00'
    mockBackend(needsReview, () => {
      server.status = newer
      return jsonResponse({ status: 'error', code: 'error.stale_review', steps: newer.steps }, 409)
    })
    renderCard('anonymize', {}, MISSES)
    const box = await screen.findByRole('checkbox', { name: 'Ik heb de mogelijke missers bekeken' })
    const callsBefore = server.statusCalls
    await userEvent.click(box)
    expect(await screen.findByRole('alert')).toHaveTextContent('Er is een nieuwer rapport; bekijk de lijst opnieuw')
    expect(box).not.toBeChecked()
    await waitFor(() => expect(box).toBeEnabled())
    expect(server.statusCalls).toBeGreaterThan(callsBefore)
    expect(screen.getByRole('button', { name: 'Verder naar stap 2' })).toBeDisabled()
    // the message survives the refresh to the newer report; the next tick sends the new id
    expect(screen.getByRole('alert')).toHaveTextContent('Er is een nieuwer rapport')
    await userEvent.click(box)
    expect(server.ackBodies.at(-1)).toEqual({ report_id: '2026-10-31T15:00:00' })
  })
})

describe('DoneCard: other states', () => {
  it('anonymize unverified: warning style, "Niet gecontroleerd", no success check, Continue disabled, check action', async () => {
    mockBackend(unverified, () => jsonResponse({}))
    const onRunCheck = vi.fn()
    const { container } = renderCard('anonymize', { onRunCheck, onContinue: vi.fn() })
    const label = await screen.findByText('Niet gecontroleerd')
    expect(label).toHaveClass('text-warning')
    expect(container.querySelector('[data-state="unverified"]')).toHaveClass('bg-warning-container')
    expect(screen.queryByText('check_circle')).toBeNull()
    expect(screen.queryByText('check')).toBeNull()
    expect(screen.queryByText(/Alles in orde/)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    const cont = screen.getByRole('button', { name: 'Verder naar stap 2' })
    expect(cont).toBeDisabled()
    expect(cont).toHaveAccessibleDescription('Voer eerst de controle uit.')
    await userEvent.click(screen.getByRole('button', { name: 'Controle nu uitvoeren' }))
    expect(onRunCheck).toHaveBeenCalledTimes(1)
  })

  it('anonymize done: success check, all-clear text, Continue enabled', async () => {
    mockBackend(allDone, () => jsonResponse({}))
    renderCard('anonymize', { onContinue: vi.fn() })
    expect(await screen.findByText('Klaar. 300 antwoorden gecontroleerd, 409 persoonsgegevens verwijderd. Alles in orde.')).toBeVisible()
    expect(screen.getByText('check')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verder naar stap 2' })).toBeEnabled()
    expect(screen.getByText(/^Laatst bijgewerkt: /)).toBeVisible()
  })

  it('stale: stale style, run again, and continuing is still allowed', async () => {
    const stale = clone(allDone)
    stale.steps.vectors.state = 'stale'
    mockBackend(stale, () => jsonResponse({}))
    const onRunAgain = vi.fn()
    const onContinue = vi.fn()
    const { container } = renderCard('vectors', { onRunAgain, onContinue })
    expect(await screen.findByText('Bijwerken nodig')).toBeVisible()
    expect(container.querySelector('[data-state="stale"]')).toHaveClass('bg-warning-container')
    await userEvent.click(screen.getByRole('button', { name: 'Opnieuw uitvoeren' }))
    expect(onRunAgain).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Verder naar stap 3' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('rerank shows the ambiguous / changed / low-information tiles', async () => {
    mockBackend(allDone, () => jsonResponse({}))
    renderCard('rerank', { onContinue: vi.fn() })
    expect(await screen.findByText('57')).toBeVisible()
    expect(screen.getByText('12')).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Verder naar stap 4' })).toBeEnabled()
  })

  it('insights: the primary action opens the Overview at /', async () => {
    mockBackend(allDone, () => jsonResponse({}))
    renderCard('insights', { onRunAgain: vi.fn() }, <p>results placeholder</p>)
    const link = await screen.findByRole('link', { name: 'Bekijk het Overzicht' })
    expect(link).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: /Verder naar stap/ })).toBeNull()
    expect(screen.getByText('results placeholder')).toBeVisible()
  })
})
