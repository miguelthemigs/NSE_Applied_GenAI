import { test, expect, noHorizontalScroll, offline } from './fixtures/api.js'
import { ANON_ROUTES, selectStep, statusFixture, stepTabs } from './fixtures/stepper.js'

const STEP_NAMES = ['Persoonsgegevens verwijderen', 'Antwoorden doorzoekbaar maken', "Thema's controleren", 'Samenvattingen schrijven', 'Stel een vraag']

const VECTOR_ROUTES = {
  '/api/inspect-anonymized': { status: 'success', text_columns: ['Open antwoord'], row_count: 120 },
  '/api/vector-checkpoint-status': { has_checkpoint: false },
}

const FILTER_OPTIONS = {
  status: 'success',
  options: { institutions: [], academic_years: [], locations: [], programmes: [], study_modes: [], cohorts: [], languages: [] },
}

const visiblePanel = (page) => page.getByRole('tabpanel')

test.describe('stepper and soft gating', () => {
  test('fresh install opens step 1; steps 2 to 5 say which step comes first', async ({ page, mockApi }) => {
    await mockApi({ '/api/pipeline/status': statusFixture('fresh'), ...ANON_ROUTES })
    await page.goto('/pipeline-demo')
    await expect(page).toHaveURL(/\?step=anonymize$/)
    await expect(visiblePanel(page)).toHaveCount(1)
    await expect(visiblePanel(page).getByRole('heading', { name: STEP_NAMES[0] })).toBeVisible()

    const tabs = await stepTabs(page)
    await expect(tabs.getByRole('tab')).toHaveCount(5)
    await expect(tabs.getByRole('tab', { name: STEP_NAMES[0] })).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.getByRole('tab', { name: `${STEP_NAMES[1]} Eerst stap 1` })).toHaveAttribute('aria-selected', 'false')
    await expect(tabs.getByRole('tab', { name: `${STEP_NAMES[2]} Eerst stap 2 · optioneel` })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: `${STEP_NAMES[3]} Eerst stap 2` })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: `${STEP_NAMES[4]} Eerst stap 2` })).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('?step=insights opens step 4 with the gate reason; clicking a tab updates the URL', async ({ page, mockApi }) => {
    await mockApi({ '/api/pipeline/status': statusFixture('fresh'), ...ANON_ROUTES })
    await page.goto('/pipeline-demo?step=insights')
    await expect(visiblePanel(page).getByRole('heading', { name: STEP_NAMES[3] })).toBeVisible()
    await expect(visiblePanel(page).getByRole('link', { name: 'Doe eerst stap 2: Antwoorden doorzoekbaar maken →' })).toBeVisible()
    const tabs = await stepTabs(page)
    await expect(tabs.getByRole('tab', { name: STEP_NAMES[3] })).toHaveAttribute('aria-selected', 'true')

    await selectStep(page, STEP_NAMES[0])
    await expect(page).toHaveURL(/\?step=anonymize$/)
    await expect(visiblePanel(page).getByRole('heading', { name: STEP_NAMES[0] })).toBeVisible()
  })

  test('step 1 unverified: the step 2 main button is disabled and the gate link opens step 1', async ({ page, mockApi }) => {
    await mockApi({ '/api/pipeline/status': statusFixture('anon-unverified'), ...ANON_ROUTES, ...VECTOR_ROUTES })
    await page.goto('/pipeline-demo?step=vectors')
    const panel = visiblePanel(page)
    await expect(panel.getByText('Open antwoord')).toBeVisible()
    await expect(panel.getByRole('button', { name: STEP_NAMES[1], exact: true })).toBeDisabled()
    await panel.getByRole('link', { name: 'Doe eerst stap 1: Persoonsgegevens verwijderen →' }).click()
    await expect(page).toHaveURL(/\?step=anonymize$/)
    const tabs = await stepTabs(page)
    await expect(tabs.getByRole('tab', { name: `${STEP_NAMES[0]} Niet gecontroleerd` })).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.getByRole('tab', { name: STEP_NAMES[1] })).toHaveAttribute('aria-selected', 'false')
  })

  test('step 1 needs review: opens step 1 with the review count; step 2 stays gated', async ({ page, mockApi }) => {
    await mockApi({ '/api/pipeline/status': statusFixture('anon-needs-review'), ...ANON_ROUTES, ...VECTOR_ROUTES })
    await page.goto('/pipeline-demo')
    await expect(page).toHaveURL(/\?step=anonymize$/)
    const tabs = await stepTabs(page)
    await expect(tabs.getByRole('tab', { name: `${STEP_NAMES[0]} 1 om na te kijken` })).toHaveAttribute('aria-selected', 'true')
    await selectStep(page, STEP_NAMES[1])
    await expect(visiblePanel(page).getByRole('button', { name: STEP_NAMES[1], exact: true })).toBeDisabled()
  })

  test('everything done: opens step 5 and every step reads done', async ({ page, mockApi }) => {
    await mockApi({ '/api/pipeline/status': statusFixture('all-done'), '/api/filter-options': FILTER_OPTIONS })
    await page.goto('/pipeline-demo')
    await expect(page).toHaveURL(/\?step=query$/)
    const tabs = await stepTabs(page)
    for (const name of STEP_NAMES.slice(0, 4)) await expect(tabs.getByRole('tab', { name: `${name} Klaar` })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: `${STEP_NAMES[4]} Klaar voor gebruik` })).toHaveAttribute('aria-selected', 'true')
  })

  test('a running stream survives switching tabs, and the status refreshes when it ends', async ({ page, mockApi }) => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    await mockApi({
      '/api/pipeline/status': statusFixture('all-done'),
      ...VECTOR_ROUTES,
      '/api/insights/results': { rows: [{ kind: 'main', done: 7, total: 7, state: 'done' }, { kind: 'sub', done: 31, total: null, state: 'done' }, { kind: 'filtered', done: 0, total: 0, state: 'off' }], estimate: null },
      'POST /api/build-vectors': async () => {
        await gate
        return {
          ndjson: [
            { status: 'progress', stage: 'process', progress: 50, message: 'encoding' },
            { status: 'success', document_count: 120 },
          ],
        }
      },
    })
    await page.goto('/pipeline-demo?step=vectors')
    const vectors = page.locator('#step-panel-vectors')
    // step 2 is already done, so its Done card shows first; "Run again" opens the settings
    await vectors.getByRole('button', { name: 'Opnieuw uitvoeren' }).click()
    await vectors.getByRole('button', { name: STEP_NAMES[1], exact: true }).click()
    await expect(vectors.getByText('Bezig…').first()).toBeVisible()

    await selectStep(page, STEP_NAMES[3])
    await expect(vectors).toBeHidden()
    await expect(visiblePanel(page).getByRole('heading', { name: STEP_NAMES[3] })).toBeVisible()
    await selectStep(page, STEP_NAMES[1])
    await expect(vectors.getByText('Bezig…').first()).toBeVisible()

    const statusCallsBefore = mockApi.requestsTo('/api/pipeline/status', 'GET').length
    release()
    await expect(vectors.getByRole('button', { name: 'Verder naar stap 3' })).toBeVisible()
    expect(mockApi.requestsTo('/api/build-vectors', 'POST')).toHaveLength(1)
    await expect.poll(() => mockApi.requestsTo('/api/pipeline/status', 'GET').length).toBeGreaterThan(statusCallsBefore)
    // no auto-advance: the result stays on screen
    await expect(page).toHaveURL(/\?step=vectors$/)
  })

  test('step 3 can be skipped; the skip is saved and step 4 opens', async ({ page, mockApi }) => {
    const before = statusFixture('all-done')
    before.steps.rerank = { state: 'not_started', completed_at: null, summary: null }
    const after = structuredClone(before)
    after.steps.rerank.state = 'skipped'
    await mockApi({
      '/api/pipeline/status': before,
      '/api/status': { status: 'success' },
      'POST /api/pipeline/skip-rerank': after,
      '/api/insights/results': { rows: [{ kind: 'main', done: 7, total: 7, state: 'done' }, { kind: 'sub', done: 31, total: null, state: 'done' }, { kind: 'filtered', done: 0, total: 0, state: 'off' }], estimate: null },
    })
    await page.goto('/pipeline-demo?step=rerank')
    await visiblePanel(page).getByRole('button', { name: 'Stap overslaan' }).click()
    await expect(page).toHaveURL(/\?step=insights$/)
    expect(mockApi.requestsTo('/api/pipeline/skip-rerank', 'POST').map((r) => r.body)).toEqual([{ skipped: true }])
  })

  test('a failed skip explains it, keeps the raw message behind "Details tonen" and stays on step 3', async ({ page, mockApi }) => {
    const before = statusFixture('all-done')
    before.steps.rerank = { state: 'not_started', completed_at: null, summary: null }
    await mockApi({
      '/api/pipeline/status': before,
      '/api/status': { status: 'success' },
      'POST /api/pipeline/skip-rerank': { status: 500, json: { status: 'error', error: 'state file locked' } },
    })
    await page.goto('/pipeline-demo?step=rerank')
    const panel = visiblePanel(page)
    await panel.getByRole('button', { name: 'Stap overslaan' }).click()
    const alert = panel.getByRole('alert')
    await expect(alert).toContainText('De stap kon niet worden overgeslagen. Probeer het opnieuw.')
    await expect(alert.getByText('state file locked')).toBeHidden()
    await alert.getByText('Details tonen').click()
    await expect(alert.getByText('state file locked')).toBeVisible()
    await expect(page).toHaveURL(/\?step=rerank$/)
  })

  test('while another step runs, main buttons say which step to wait for', async ({ page, mockApi }) => {
    const running = statusFixture('all-done')
    running.active_job = { step: 'insights', stage: null, progress: null }
    running.steps.insights.state = 'in_progress'
    running.steps.rerank = { state: 'not_started', completed_at: null, summary: null }
    await mockApi({ '/api/pipeline/status': running, '/api/status': { status: 'success' } })
    await page.goto('/pipeline-demo?step=rerank')
    const panel = visiblePanel(page)
    await expect(panel.getByRole('button', { name: "Thema's controleren", exact: true })).toBeDisabled()
    await panel.getByRole('link', { name: 'Wacht tot stap 4 klaar is' }).click()
    await expect(page).toHaveURL(/\?step=insights$/)
    // the running step itself shows no "wait" reason
    await expect(visiblePanel(page).getByRole('link', { name: /Wacht tot stap/ })).toHaveCount(0)
  })

  test('backend offline: the page explains it and keeps the steps', async ({ page }) => {
    await offline(page)
    await page.goto('/pipeline-demo')
    await expect(page.getByRole('status').filter({ hasText: 'De analyse-service is niet bereikbaar. Start de app opnieuw.' })).toBeVisible()
    await expect(visiblePanel(page).getByRole('heading', { name: STEP_NAMES[0] })).toBeVisible()
  })

  test('small screens show the collapsed "Stap 2 van 5" control; large screens the full tablist', async ({ page, mockApi }, testInfo) => {
    await mockApi({ '/api/pipeline/status': statusFixture('vectors-running'), ...VECTOR_ROUTES })
    await page.goto('/pipeline-demo')
    await expect(page).toHaveURL(/\?step=vectors$/)
    const toggle = page.locator('button[aria-controls="pipeline-stepper"]')
    if (testInfo.project.name === 'mobile') {
      await expect(toggle).toBeVisible()
      await expect(toggle).toContainText('Stap 2 van 5')
      await expect(toggle).toContainText(STEP_NAMES[1])
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByRole('tablist')).toBeHidden()
      await noHorizontalScroll(page)
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('tab', { name: `${STEP_NAMES[1]} Bezig… 42%` })).toHaveAttribute('aria-selected', 'true')
      await noHorizontalScroll(page)
    } else {
      await expect(toggle).toBeHidden()
      await expect(page.getByRole('tab', { name: `${STEP_NAMES[1]} Bezig… 42%` })).toHaveAttribute('aria-selected', 'true')
    }
  })
})
