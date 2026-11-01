import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider.jsx'
import { PipelineStatusProvider } from '../context/PipelineStatusContext.jsx'
import ThemeReranker from './ThemeReranker.jsx'
import allDone from '../../e2e/fixtures/status/all-done.json'

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

function statusWith(states) {
  const s = structuredClone(allDone)
  for (const [id, state] of Object.entries(states)) s.steps[id] = { ...s.steps[id], state }
  return s
}

function renderStep(status) {
  fetch.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path === '/api/pipeline/status') return jsonResponse(status)
    if (path === '/api/status') return jsonResponse({ status: 'success' })
    if (path === '/api/pipeline/skip-rerank' && init?.method === 'POST') return jsonResponse(status)
    return jsonResponse({}, 404)
  })
  const onNavigate = vi.fn()
  render(
    <I18nProvider>
      <MemoryRouter>
        <PipelineStatusProvider>
          <ThemeReranker onNavigate={onNavigate} />
        </PipelineStatusProvider>
      </MemoryRouter>
    </I18nProvider>,
  )
  return { onNavigate }
}

const skipCalls = () => fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/api/pipeline/skip-rerank')

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ThemeReranker skip', () => {
  it('is disabled, like the main button, while step 1 needs review even with vectors done', async () => {
    renderStep(statusWith({ anonymize: 'needs_review', rerank: 'not_started', insights: 'not_started' }))
    expect(await screen.findByRole('link', { name: /Doe eerst stap 1: Persoonsgegevens verwijderen/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stap overslaan' })).toBeDisabled()
    expect(screen.getByRole('button', { name: "Thema's controleren" })).toBeDisabled()
    expect(skipCalls()).toHaveLength(0)
  })

  it('is disabled while another step runs', async () => {
    const status = statusWith({ rerank: 'not_started', insights: 'not_started' })
    status.active_job = { step: 'insights', stage: 'process', progress: 10 }
    renderStep(status)
    expect(await screen.findByRole('link', { name: /Wacht tot stap 4 klaar is/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stap overslaan' })).toBeDisabled()
  })

  it('saves the skip when the step can start', async () => {
    const { onNavigate } = renderStep(statusWith({ rerank: 'not_started', insights: 'not_started' }))
    const skip = await screen.findByRole('button', { name: 'Stap overslaan' })
    await waitFor(() => expect(skip).toBeEnabled())
    await userEvent.click(skip)
    await waitFor(() => expect(skipCalls()).toHaveLength(1))
    expect(onNavigate).toHaveBeenCalledWith('insights')
  })
})
