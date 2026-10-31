import { test, expect } from './fixtures/api.js'
import { statusFixture } from './fixtures/stepper.js'

const G12B = 'unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL'

const VECTOR_ROUTES = {
  '/api/pipeline/status': statusFixture('anon-done'),
  '/api/inspect-anonymized': { status: 'success', text_columns: ['Open antwoord'], row_count: 120 },
  '/api/vector-checkpoint-status': { has_checkpoint: false },
}

const notStarted = statusFixture('all-done')
notStarted.steps.insights.state = 'not_started'
notStarted.steps.insights.summary = null

const INSIGHT_ROUTES = {
  '/api/pipeline/status': notStarted,
  '/api/cache-status': { main_baseline: 0, main_filtered: 0, subtheme_baseline: 0, subtheme_filtered: 0 },
  '/api/vector-stats': { total_documents: 120 },
  '/api/filter-options': { status: 'success', options: {} },
}

/**
 * Replaces fetch for POST `path` with a stream the test feeds by hand, so the panel can be
 * inspected while the run is still active. (A fulfilled mock body arrives whole.)
 */
async function holdStream(page, path) {
  await page.addInitScript((target) => {
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      if (!url.endsWith(target) || init?.method !== 'POST') return realFetch(input, init)
      const enc = new TextEncoder()
      const stream = new ReadableStream({ start(c) { window.__pushEvent = (e) => c.enqueue(enc.encode(JSON.stringify(e) + '\n')); window.__endStream = () => c.close() } })
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    }
  }, path)
}

const push = (page, event) => page.evaluate((e) => window.__pushEvent(e), event)
const download = (done, total, tier) => ({ status: 'progress', stage: 'download', params: { bytes_done: done, bytes_total: total, tier } })

test.describe('visible model downloads', () => {
  test('step 2 shows "x van y GB" while downloading, then switches to the load stage', async ({ page, mockApi }) => {
    await holdStream(page, '/api/build-vectors')
    await mockApi(VECTOR_ROUTES)
    await page.goto('/pipeline-demo?step=vectors')
    const vectors = page.locator('#step-panel-vectors')
    await vectors.getByRole('button', { name: 'Antwoorden doorzoekbaar maken', exact: true }).click()
    await expect.poll(() => page.evaluate(() => typeof window.__pushEvent)).toBe('function')

    await push(page, download(0, 1.2e9, 'balanced'))
    await push(page, download(0.4e9, 1.2e9, 'balanced'))
    const line = vectors.getByText('Het Gebalanceerd-model wordt gedownload: 0,4 GB van 1,2 GB')
    await expect(line).toBeVisible()
    await expect(vectors.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33')
    await expect(vectors.getByRole('status')).toHaveText('Model laden')

    await push(page, download(1.2e9, 1.2e9, 'balanced'))
    await push(page, { status: 'progress', stage: 'load', progress: 25, message: 'Loading model' })
    await expect(line).toHaveCount(0)
    await expect(vectors.getByText(/wordt gedownload/)).toHaveCount(0)
    await expect(vectors.getByRole('status')).toHaveText('Model laden')
    await expect(vectors.getByText('25%')).toBeVisible()
    await page.evaluate(() => window.__endStream())
  })

  test('step 4 shows the start-stream download with the picked tier, then loads', async ({ page, mockApi }) => {
    await holdStream(page, '/api/llm-models/start-stream')
    await mockApi(INSIGHT_ROUTES)
    await page.goto('/pipeline-demo?step=insights')
    const insights = page.locator('#step-panel-insights')
    await insights.getByRole('radio', { name: /Snel/ }).check()
    await insights.getByRole('button', { name: /Thema's samenvatten/ }).click()
    await expect.poll(() => page.evaluate(() => typeof window.__pushEvent)).toBe('function')

    await push(page, download(1.3e9, 2.6e9, 'quick'))
    await expect(insights.getByText('Het Snel-model wordt gedownload: 1,3 GB van 2,6 GB')).toBeVisible()
    await push(page, { status: 'progress', stage: 'load' })
    await expect(insights.getByText(/wordt gedownload/)).toHaveCount(0)
    await expect(insights.getByRole('status')).toHaveText('Model laden')
    await page.evaluate(() => window.__endStream())
  })

  test('a start-stream error shows the translated message at once, with no retries', async ({ page, mockApi }) => {
    await mockApi({
      ...INSIGHT_ROUTES,
      'POST /api/llm-models/start-stream': {
        ndjson: [
          { status: 'progress', stage: 'load', params: { tier: 'balanced', model: G12B } },
          { status: 'error', code: 'error.llm_unavailable', error: 'llama-server exited before becoming ready.' },
        ],
      },
      'POST /api/precompute-insights': { ndjson: [{ status: 'success', progress: 100 }] },
    })
    await page.goto('/pipeline-demo?step=insights')
    const insights = page.locator('#step-panel-insights')
    await insights.getByRole('button', { name: /Thema's samenvatten/ }).click()

    const alert = insights.getByRole('alert').filter({ hasText: 'Het AI-model kon niet worden gestart' })
    await expect(alert).toBeVisible()
    // The raw backend text waits behind "Details tonen".
    await expect(alert.getByText('llama-server exited before becoming ready.')).toBeHidden()
    await alert.getByText('Details tonen').click()
    await expect(alert.getByText('llama-server exited before becoming ready.')).toBeVisible()

    // Give a retry time to fire before counting the requests.
    await page.waitForTimeout(1500)
    expect(mockApi.requestsTo('/api/llm-models/start-stream', 'POST')).toHaveLength(1)
    expect(mockApi.requestsTo('/api/llm-models/start-stream', 'POST')[0].body.model_id).toBe(G12B)
    expect(mockApi.requestsTo('/api/precompute-insights', 'POST')).toHaveLength(0)
    expect(mockApi.requests.filter((r) => r.path === '/api/llm-models/start')).toHaveLength(0)
  })
})
