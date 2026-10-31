import { test, expect, noHorizontalScroll } from './fixtures/api.js'
import { statusFixture } from './fixtures/stepper.js'

const G12B = 'unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL'
const RUN = 'Samenvattingen schrijven'

const notStarted = statusFixture('all-done')
notStarted.steps.insights = { state: 'not_started', completed_at: null, summary: null }

const RESULTS = {
  rows: [
    { kind: 'main', done: 0, total: 7, state: 'not_started' },
    { kind: 'sub', done: 0, total: null, state: 'not_started' },
    { kind: 'filtered', done: 0, total: 0, state: 'off' },
  ],
  estimate: null,
}

const ROUTES = {
  '/api/pipeline/status': notStarted,
  '/api/insights/results': RESULTS,
  'POST /api/llm-models/start-stream': { ndjson: [{ status: 'progress', stage: 'load' }, { status: 'success' }] },
  'POST /api/precompute-insights': { ndjson: [{ status: 'progress', stage: 'process', progress: 50 }, { status: 'success', progress: 100 }] },
}

/** Replaces fetch for POST /api/precompute-insights with a stream the test feeds by hand. */
async function holdPrecompute(page) {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      if (!url.endsWith('/api/precompute-insights') || init?.method !== 'POST') return realFetch(input, init)
      window.__precomputeBody = JSON.parse(init.body)
      const enc = new TextEncoder()
      const stream = new ReadableStream({ start(c) { window.__pushEvent = (e) => c.enqueue(enc.encode(JSON.stringify(e) + '\n')); window.__endStream = () => c.close() } })
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    }
  })
}

const push = (page, event) => page.evaluate((e) => window.__pushEvent(e), event)

test.describe('step 4: write summaries', () => {
  test('one primary button; a run shows one progress panel, then the results list', async ({ page, mockApi }) => {
    await holdPrecompute(page)
    await mockApi(ROUTES)
    await page.goto('/pipeline-demo?step=insights')
    const p = page.locator('#step-panel-insights')

    await expect(p.getByRole('button', { name: RUN })).toHaveCount(1)
    await expect(p.getByRole('button', { name: /Thema's samenvatten|Subthema's samenvatten|per filter/ })).toHaveCount(0)
    await expect(p.getByRole('heading', { name: 'Resultaten' })).toBeVisible()
    const filtered = p.getByRole('listitem').filter({ hasText: 'Per jaar, locatie en opleiding' })
    await expect(filtered).toContainText('Uit')
    await noHorizontalScroll(page)

    await p.getByRole('button', { name: RUN }).click()
    await expect.poll(() => page.evaluate(() => typeof window.__pushEvent)).toBe('function')
    // start-stream ran first, with the tier's model, and only then the precompute.
    expect(mockApi.requestsTo('/api/llm-models/start-stream', 'POST').map((r) => r.body.model_id)).toEqual([G12B])
    expect(await page.evaluate(() => window.__precomputeBody)).toEqual({
      precache_subthemes: true, filter_dimensions: [], model_id: G12B, max_documents: 240,
    })

    await push(page, { status: 'progress', stage: 'process', progress: 40, message: 'Generating' })
    await expect(p.getByText('Details tonen')).toHaveCount(1)
    await expect(p.getByRole('status')).toHaveText('Verwerken')
    await expect(p.getByText('40%')).toBeVisible()
    await expect(p.getByRole('button', { name: RUN })).toHaveCount(0)
    // A stray `load` event mid-run does not move the stage bar back.
    await push(page, { status: 'progress', stage: 'load', progress: 1 })
    await expect(p.getByRole('status')).toHaveText('Verwerken')
    await expect(p.getByText('40%')).toBeVisible()

    await push(page, { status: 'success', progress: 100 })
    await page.evaluate(() => window.__endStream())
    await expect(p.getByRole('status').filter({ hasText: 'De samenvattingen staan klaar voor het Overzicht.' })).toBeVisible()
    await expect(p.getByText('Details tonen')).toHaveCount(0)
    await expect(p.getByRole('heading', { name: 'Resultaten' })).toBeVisible()
    await expect(p.getByRole('listitem').filter({ hasText: "Hoofdthema's" })).toBeVisible()
  })

  test('the combinations toggle shows the estimate; above 500 it asks first and sends nothing until confirmed', async ({ page, mockApi }) => {
    await mockApi({
      ...ROUTES,
      'POST /api/precompute-preview': { valid_combos: 86, estimate: { count: 600, minutes: 900 } },
    })
    await page.goto('/pipeline-demo?step=insights')
    const p = page.locator('#step-panel-insights')
    await p.getByRole('checkbox', { name: /elke combinatie van jaar, locatie en opleiding/ }).check()
    await expect(p.getByText(/600 samenvattingen, ongeveer 900 min/)).toBeVisible()
    expect(mockApi.requestsTo('/api/precompute-preview', 'POST')[0].body).toEqual({ filter_dimensions: ['academic_year', 'location', 'programme'] })

    const messages = []
    page.once('dialog', (d) => { messages.push(d.message()); d.dismiss() })
    await p.getByRole('button', { name: RUN }).click()
    await expect.poll(() => messages).toEqual(['Dit zijn 600 samenvattingen en duurt ongeveer 15 uur. Doorgaan?'])
    await page.waitForTimeout(300)
    expect(mockApi.requestsTo('/api/precompute-insights', 'POST')).toHaveLength(0)
    expect(mockApi.requestsTo('/api/llm-models/start-stream', 'POST')).toHaveLength(0)

    page.once('dialog', (d) => d.accept())
    await p.getByRole('button', { name: RUN }).click()
    await expect.poll(() => mockApi.requestsTo('/api/precompute-insights', 'POST').length).toBe(1)
    expect(mockApi.requestsTo('/api/precompute-insights', 'POST')[0].body.filter_dimensions).toEqual(['academic_year', 'location', 'programme'])
  })

  test('clearing saved summaries lives under Advanced and asks first', async ({ page, mockApi }) => {
    await mockApi({ ...ROUTES, 'POST /api/clear-cache': { status: 'success' }, 'POST /api/clear-subtheme-cache': { status: 'success' } })
    await page.goto('/pipeline-demo?step=insights')
    const p = page.locator('#step-panel-insights')
    const clear = p.getByRole('button', { name: 'Opgeslagen samenvattingen wissen' })
    await expect(clear).toBeHidden()
    await p.locator('details').filter({ hasText: 'Opgeslagen samenvattingen wissen' }).locator('summary').click()
    page.once('dialog', (d) => d.dismiss())
    await clear.click()
    await page.waitForTimeout(300)
    expect(mockApi.requestsTo('/api/clear-cache', 'POST')).toHaveLength(0)
  })

  test('Overview without summaries shows the empty state with a link to step 4', async ({ page, mockApi }) => {
    await mockApi({
      '/api/filter-options': { status: 'success', options: { academic_years: ['2024'], locations: [], programmes: [], study_modes: [], cohorts: [], sectors: [], languages: [] } },
      '/api/pipeline/status': notStarted,
      '/api/themes-overview': { status: 'not_ready', reason: 'no_summaries', themes: {}, themes_expected: 7 },
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Er zijn nog geen samenvattingen' })).toBeVisible()
    const link = page.getByRole('link', { name: 'Ga naar stap 4: Samenvattingen schrijven' })
    await expect(link).toHaveAttribute('href', '/pipeline-demo?step=insights')
    await noHorizontalScroll(page)
    await link.click()
    await expect(page).toHaveURL(/\/pipeline-demo\?step=insights$/)
    await expect(page.locator('#step-panel-insights').getByRole('button', { name: RUN })).toBeVisible()
  })
})
