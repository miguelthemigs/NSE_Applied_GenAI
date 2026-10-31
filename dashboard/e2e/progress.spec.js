import { test, expect } from './fixtures/api.js'
import { statusFixture } from './fixtures/stepper.js'

const VECTOR_ROUTES = {
  '/api/pipeline/status': statusFixture('anon-done'),
  '/api/inspect-anonymized': { status: 'success', text_columns: ['Open antwoord'], row_count: 120 },
  '/api/vector-checkpoint-status': { has_checkpoint: false },
}

/** The status after a successful build: step 2 done, so its Done card shows. */
function builtStatus() {
  const s = statusFixture('anon-done')
  s.last_updated = '2026-10-31T14:31:00Z'
  s.steps.vectors = { state: 'done', completed_at: '2026-10-31T14:31:00Z', summary: { documents: 120, tier: 'balanced', model: 'Octen/Octen-Embedding-0.6B' }, checkpoint: null }
  return s
}

/** Status route that answers "built" once `isBuilt()` is true. */
const statusRoute = (isBuilt) => () => (isBuilt() ? builtStatus() : statusFixture('anon-done'))

const START = 'Antwoorden doorzoekbaar maken'

/**
 * Replaces fetch for POST /api/build-vectors with a stream the test feeds by hand, so the
 * panel can be inspected while a run is still active. (A fulfilled mock body arrives whole.)
 */
async function holdBuildStream(page) {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      if (!url.endsWith('/api/build-vectors') || init?.method !== 'POST') return realFetch(input, init)
      const enc = new TextEncoder()
      const stream = new ReadableStream({ start(c) { window.__pushEvent = (e) => c.enqueue(enc.encode(JSON.stringify(e) + '\n')); window.__endStream = () => c.close() } })
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    }
  })
}

const push = (page, event) => page.evaluate((e) => window.__pushEvent(e), event)

test.describe('shared progress panel', () => {
  test('no progress panel before a run starts', async ({ page, mockApi }) => {
    await mockApi(VECTOR_ROUTES)
    await page.goto('/pipeline-demo?step=vectors')
    const vectors = page.locator('#step-panel-vectors')
    await expect(vectors.getByRole('button', { name: START, exact: true })).toBeEnabled()
    await expect(page.getByText('0%')).toHaveCount(0)
    await expect(vectors.getByRole('status')).toHaveCount(0)
  })

  test('a running build shows a light panel with stage, percentage and collapsed logs', async ({ page, mockApi }) => {
    await holdBuildStream(page)
    let built = false
    await mockApi({ ...VECTOR_ROUTES, '/api/pipeline/status': statusRoute(() => built) })
    await page.goto('/pipeline-demo?step=vectors')
    const vectors = page.locator('#step-panel-vectors')
    await vectors.getByRole('button', { name: START, exact: true }).click()

    await expect.poll(() => page.evaluate(() => typeof window.__pushEvent)).toBe('function')
    await push(page, { status: 'progress', stage: 'download', progress: 12, message: 'fetching weights' })
    await push(page, { status: 'progress', stage: 'load', progress: 20, message: 'loading model' })
    await push(page, { status: 'progress', stage: 'process', progress: 42, message: 'encoding batch 3' })

    const status = vectors.getByRole('status')
    await expect(status).toHaveText('Verwerken')
    await expect(vectors.getByText('42%')).toBeVisible()
    await expect(vectors.getByRole('listitem').filter({ hasText: 'Gegevens lezen' })).toBeVisible()

    // the card is white, not the old dark panel
    const card = status.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)')

    // raw messages stay behind "Details tonen"
    await expect(vectors.getByText('encoding batch 3')).toBeHidden()
    await vectors.getByText('Details tonen').click()
    await expect(vectors.getByText('encoding batch 3')).toBeVisible()
    await expect(vectors.getByText('fetching weights')).toBeVisible()

    built = true
    await push(page, { status: 'success', document_count: 120 })
    await page.evaluate(() => window.__endStream())
    await expect(vectors.getByRole('button', { name: 'Verder naar stap 3' })).toBeVisible()
    await expect(vectors.getByText('Klaar. 120 antwoorden zijn doorzoekbaar (model: Gebalanceerd).')).toBeVisible()
    await expect(vectors.getByRole('status')).toHaveCount(0)
  })

  test('a mocked NDJSON build ends without leaving a panel behind', async ({ page, mockApi }) => {
    let built = false
    await mockApi({
      ...VECTOR_ROUTES,
      '/api/pipeline/status': statusRoute(() => built),
      'POST /api/build-vectors': () => {
        built = true
        return {
          ndjson: [
            { status: 'progress', stage: 'download', progress: 5, message: 'a' },
            { status: 'progress', stage: 'load', progress: 20, message: 'b' },
            { status: 'progress', stage: 'process', progress: 60, message: 'c' },
            { status: 'success', document_count: 120 },
          ],
        }
      },
    })
    await page.goto('/pipeline-demo?step=vectors')
    const vectors = page.locator('#step-panel-vectors')
    await vectors.getByRole('button', { name: START, exact: true }).click()
    await expect(vectors.getByRole('button', { name: 'Verder naar stap 3' })).toBeVisible()
    await expect(page.getByText('0%')).toHaveCount(0)
  })
})
