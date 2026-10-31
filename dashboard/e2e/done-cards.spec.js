import { test, expect } from './fixtures/api.js'
import { ANON_ROUTES, statusFixture } from './fixtures/stepper.js'

const REPORT_ID = '2026-10-31T14:12:00'
const MISS = '[MOGELIJKE NAAM]'

// GET /api/anonymize-report for the report the needs-review fixture points at.
const REPORT = {
  has_report: true,
  timestamp: REPORT_ID,
  rows_processed: 300,
  total_entities: 409,
  tag_counts: { NAME: 280, TITLE: 8, LOCATION: 16, PII: 73, HEALTH: 32 },
  missed_counts: { NAME: 1, LOCATION: 0, PII: 0, TITLE: 0, HEALTH: 0 },
  missed_samples: { NAME: [MISS] },
  removed_samples: { NAME: ['[NAAM]'] },
  verification_skipped: false,
}

function acknowledgedStatus() {
  const s = statusFixture('anon-needs-review')
  s.steps.anonymize.state = 'done'
  s.steps.anonymize.summary.acknowledged = true
  s.steps.vectors.state = 'not_started'
  return s
}

/** Step 1 routes with a status that flips to "acknowledged" once the backend accepted the tick. */
function reviewRoutes({ ack }) {
  const server = { acknowledged: false }
  const routes = {
    ...ANON_ROUTES,
    '/api/anonymize-report': REPORT,
    '/api/pipeline/status': () => (server.acknowledged ? acknowledgedStatus() : statusFixture('anon-needs-review')),
    'POST /api/pipeline/acknowledge-review': (route, request) => ack(server, request.postDataJSON()),
  }
  return routes
}

const panel = (page) => page.locator('#step-panel-anonymize')

test.describe('done cards and the review gate', () => {
  test('the welcome-back banner shows once per browser session', async ({ page, mockApi }) => {
    await mockApi({ ...ANON_ROUTES, '/api/anonymize-report': REPORT, '/api/pipeline/status': statusFixture('anon-needs-review') })
    await page.goto('/pipeline-demo')
    const banner = page.getByRole('status').filter({ hasText: 'Welkom terug' })
    await expect(banner).toHaveText(/Welkom terug\. Je eerdere werk is bewaard \(laatst bijgewerkt .*2026.*\)\./)
    await expect(page.getByText(/^Laatst bijgewerkt: .*2026/).first()).toBeVisible()
    await page.reload()
    await expect(panel(page).getByText('Mogelijk gemist (1)')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Welkom terug' })).toHaveCount(0)
  })

  test('no welcome-back banner on a fresh install', async ({ page, mockApi }) => {
    await mockApi({ ...ANON_ROUTES, '/api/pipeline/status': statusFixture('fresh') })
    await page.goto('/pipeline-demo')
    await expect(panel(page).getByText('Sleep je bestand hierheen of klik om te kiezen')).toBeVisible()
    await expect(page.getByText(/Welkom terug/)).toHaveCount(0)
    await expect(page.getByText(/Laatst bijgewerkt/)).toHaveCount(0)
  })

  test('needs review: the miss list is visible, Continue waits for the tick, the tick is saved, then Continue works', async ({ page, mockApi }) => {
    await mockApi(reviewRoutes({
      ack: (server, body) => {
        if (body?.report_id !== REPORT_ID) return { status: 409, json: { status: 'error', code: 'error.stale_review' } }
        server.acknowledged = true
        return acknowledgedStatus()
      },
    }))
    await page.goto('/pipeline-demo')
    const p = panel(page)
    await expect(p.getByText('Klaar. 300 antwoorden gecontroleerd, 409 persoonsgegevens verwijderd, 1 om na te kijken.')).toBeVisible()
    await expect(p.getByText('Mogelijk gemist (1)')).toBeVisible()
    await expect(p.getByText(MISS)).toBeVisible()
    for (const label of ['Namen', 'Locaties', 'Persoonlijke nummers', 'Gezondheid']) await expect(p.getByText(label, { exact: true })).toBeVisible()

    const cont = p.getByRole('button', { name: 'Verder naar stap 2' })
    await expect(cont).toBeDisabled()
    await expect(p.getByText('Vink eerst aan dat je de mogelijke missers hebt bekeken.')).toBeVisible()

    await p.getByRole('checkbox', { name: 'Ik heb de mogelijke missers bekeken' }).check()
    await expect(cont).toBeEnabled()
    expect(mockApi.requestsTo('/api/pipeline/acknowledge-review', 'POST').map((r) => r.body)).toEqual([{ report_id: REPORT_ID }])
    // the list stays visible after acknowledging
    await expect(p.getByText(MISS)).toBeVisible()
    await expect(p.getByRole('checkbox', { name: 'Ik heb de mogelijke missers bekeken' })).toBeChecked()

    await cont.click()
    await expect(page).toHaveURL(/\?step=vectors$/)
  })

  test('a newer report (409 stale_review) unticks the box and asks to review again', async ({ page, mockApi }) => {
    await mockApi(reviewRoutes({
      ack: () => ({ status: 409, json: { ...statusFixture('anon-needs-review'), status: 'error', code: 'error.stale_review' } }),
    }))
    await page.goto('/pipeline-demo')
    const p = panel(page)
    const box = p.getByRole('checkbox', { name: 'Ik heb de mogelijke missers bekeken' })
    const statusCalls = () => mockApi.requestsTo('/api/pipeline/status', 'GET').length
    await expect(box).toBeEnabled()
    const before = statusCalls()
    await box.click()
    await expect(p.getByRole('alert')).toHaveText('Er is een nieuwer rapport; bekijk de lijst opnieuw')
    await expect(box).not.toBeChecked()
    await expect(box).toBeEnabled()
    await expect.poll(statusCalls).toBeGreaterThan(before)
    await expect(p.getByRole('button', { name: 'Verder naar stap 2' })).toBeDisabled()
    await expect(p.getByText(MISS)).toBeVisible()
  })

  test('needs review: the existing-dataset Continue on the upload screen is disabled too', async ({ page, mockApi }) => {
    await mockApi(reviewRoutes({ ack: () => ({ status: 500, json: {} }) }))
    await page.goto('/pipeline-demo')
    const p = panel(page)
    await p.getByRole('button', { name: 'Opnieuw uitvoeren' }).click()
    await expect(p.getByText('Er is al een geanonimiseerde dataset beschikbaar.')).toBeVisible()
    const cont = p.getByRole('button', { name: 'Verder naar stap 2' })
    await expect(cont).toHaveCount(1)
    await expect(cont).toBeDisabled()
    await expect(cont).toHaveAccessibleDescription('Vink eerst aan dat je de mogelijke missers hebt bekeken.')
    // back to the Done card, where the review box is
    await p.getByRole('button', { name: 'Resultaten bekijken' }).click()
    await expect(p.getByText('Mogelijk gemist (1)')).toBeVisible()
  })

  test('unverified: amber "Niet gecontroleerd", no green check, Continue disabled, the check can be run', async ({ page, mockApi }) => {
    const unverifiedReport = { ...REPORT, missed_counts: {}, missed_samples: {}, verification_skipped: true }
    await mockApi({
      ...ANON_ROUTES,
      '/api/anonymize-report': unverifiedReport,
      '/api/pipeline/status': statusFixture('anon-unverified'),
      'POST /api/run-anonymize-check': { ndjson: [{ status: 'progress', stage: 'process', progress: 50 }, { status: 'success', stats: {} }] },
    })
    await page.goto('/pipeline-demo')
    const p = panel(page)
    const card = p.locator('[data-state="unverified"]')
    await expect(card).toBeVisible()
    await expect(card).toHaveCSS('background-color', 'rgb(255, 241, 214)') // warning-container
    await expect(card.getByText('Niet gecontroleerd')).toHaveCSS('color', 'rgb(138, 83, 0)') // warning
    await expect(p.locator('.bg-success')).toHaveCount(0)
    await expect(p.getByText(/Alles in orde/)).toHaveCount(0)
    await expect(p.getByRole('checkbox')).toHaveCount(0)
    await expect(p.getByRole('button', { name: 'Verder naar stap 2' })).toBeDisabled()
    await expect(p.getByText('Voer eerst de controle uit.')).toBeVisible()

    await p.getByRole('button', { name: 'Controle nu uitvoeren' }).click()
    await expect.poll(() => mockApi.requestsTo('/api/run-anonymize-check', 'POST').length).toBe(1)
  })

  test('all done: done cards on steps 2 to 4; step 4 opens the Overview', async ({ page, mockApi }) => {
    await mockApi({
      '/api/pipeline/status': statusFixture('all-done'),
      '/api/inspect-anonymized': { status: 'success', text_columns: ['Open antwoord'], row_count: 120 },
      '/api/vector-checkpoint-status': { has_checkpoint: false },
      '/api/status': { status: 'success' },
      '/api/cache-status': { main_baseline: 7, main_filtered: 0, subtheme_baseline: 0, subtheme_filtered: 0 },
    })
    await page.goto('/pipeline-demo?step=vectors')
    await expect(page.locator('#step-panel-vectors').getByText('Klaar. 900 antwoorden zijn doorzoekbaar (model: Gebalanceerd).')).toBeVisible()
    await page.goto('/pipeline-demo?step=rerank')
    await expect(page.locator('#step-panel-rerank').getByText(/^Klaar\. 57 twijfelgevallen opnieuw gelezen/)).toBeVisible()
    await page.goto('/pipeline-demo?step=insights')
    const insights = page.locator('#step-panel-insights')
    await expect(insights.getByText("Klaar. Samenvattingen voor 7 van 7 thema's staan op het Overzicht.")).toBeVisible()
    await expect(insights.getByText('Hoofdthema\'s')).toBeVisible()
    await insights.getByRole('link', { name: 'Bekijk het Overzicht' }).click()
    await expect(page).toHaveURL(/\/$/)
  })
})
