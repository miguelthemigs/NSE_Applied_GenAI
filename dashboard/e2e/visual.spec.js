import { fileURLToPath } from 'node:url'
import { test, expect, noHorizontalScroll } from './fixtures/api.js'
import { ANON_ROUTES, statusFixture } from './fixtures/stepper.js'

/**
 * One colour, one light style, no horizontal scroll (spec D11, D13).
 * Full-page screenshots land in e2e/__screens__/ (git-ignored) for the
 * acceptance pass against docs/superpowers/mockups/.
 */
const SCREENS = new URL('./__screens__/', import.meta.url)
async function shot(page, name) {
  // The nav is sticky: from the top, a full-page shot shows it where it belongs.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: fileURLToPath(new URL(`${name}-${test.info().project.name}.png`, SCREENS)), fullPage: true })
}

const STEPS = ['anonymize', 'vectors', 'rerank', 'insights', 'query']

const REPORT = {
  has_report: true,
  timestamp: '2026-10-31T14:12:00',
  rows_processed: 300,
  total_entities: 409,
  tag_counts: { NAME: 280, TITLE: 8, LOCATION: 16, PII: 73, HEALTH: 32 },
  missed_counts: { NAME: 1, LOCATION: 0, PII: 0, TITLE: 0, HEALTH: 0 },
  missed_samples: { NAME: ['[MOGELIJKE NAAM]'] },
  removed_samples: { NAME: ['[NAAM]'] },
  verification_skipped: false,
}

const row = (step, tier, model_id, size_bytes, cached = false) => ({ tier, step, model_id, size_bytes, cached })
const TIERS = {
  tiers: [
    row('vectors', 'quick', 'Octen/Octen-Embedding-0.6B', 2.62e9),
    row('vectors', 'balanced', 'Octen/Octen-Embedding-0.6B', 6.2e9, true),
    row('vectors', 'thorough', 'Octen/Octen-Embedding-4B', 16.9e9),
    row('insights', 'quick', 'unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL', 2.62e9),
    row('insights', 'balanced', 'unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL', 6.2e9, true),
    row('insights', 'thorough', 'unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL', 16.9e9),
  ],
  advanced: { vectors: ['Octen/Octen-Embedding-0.6B', 'Octen/Octen-Embedding-4B'], insights: ['unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL'] },
}

/** Every route the five step panels request on mount. */
const PANEL_ROUTES = {
  ...ANON_ROUTES,
  '/api/model-tiers': TIERS,
  '/api/inspect-anonymized': { status: 'success', text_columns: ['Open antwoord', 'Verbeterpunt', 'Toelichting'], row_count: 300 },
  '/api/vector-checkpoint-status': { has_checkpoint: false },
  '/api/status': { status: 'success' },
  '/api/insights/results': {
    rows: [
      { kind: 'main', done: 3, total: 7, state: 'partial' },
      { kind: 'sub', done: 0, total: null, state: 'not_started' },
      { kind: 'filtered', done: 0, total: 0, state: 'off' },
    ],
  },
  '/api/filter-options': { status: 'success', options: { institutions: [], academic_years: ['2025'], locations: [], programmes: [], study_modes: [], cohorts: [] } },
}

function rerankOpen() {
  const s = statusFixture('all-done')
  s.steps.rerank = { state: 'not_started', completed_at: null, summary: null }
  s.steps.insights = { state: 'not_started', completed_at: null, summary: null }
  return s
}

function insightsPartial() {
  const s = statusFixture('all-done')
  s.steps.insights.state = 'partial'
  s.steps.insights.summary = { themes_done: 3, themes_total: 7, subthemes_done: 0, filtered_done: 0, filtered_total: 0 }
  return s
}

function vectorsNext() {
  const s = statusFixture('anon-done')
  return s
}

/** Old palette: purple / fuchsia / pink hues, or dark slate-grey panels. */
async function oldPaletteBackgrounds(page) {
  return page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const [r, g, b, a = 1] = m[1].split(',').map((v) => parseFloat(v))
      return { r: r / 255, g: g / 255, b: b / 255, a }
    }
    const hsl = ({ r, g, b }) => {
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const l = (max + min) / 2
      if (max === min) return { h: 0, s: 0, l }
      const d = max - min
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      let h
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      else if (max === g) h = ((b - r) / d + 2) * 60
      else h = ((r - g) / d + 4) * 60
      return { h, s, l }
    }
    const hits = []
    for (const el of document.querySelectorAll('main *')) {
      const style = getComputedStyle(el)
      if (style.backgroundImage.includes('gradient')) hits.push(`${el.tagName}.${el.className}: gradient`)
      const c = parse(style.backgroundColor)
      if (!c || c.a < 0.05) continue
      const { h, s, l } = hsl(c)
      const purple = s > 0.25 && h >= 250 && h <= 345 && l < 0.97
      const darkSlate = l < 0.25 && s < 0.6
      if (purple || darkSlate) hits.push(`${el.tagName}.${el.className}: ${style.backgroundColor}`)
    }
    return hits
  })
}

test.describe('visual: one colour, light style, no horizontal scroll', () => {
  test('overview and compare pages do not scroll sideways', async ({ page, mockApi }) => {
    await mockApi({
      ...PANEL_ROUTES,
      '/api/pipeline/status': statusFixture('all-done'),
      '/api/themes-overview': { status: 'not_ready', reason: 'no_summaries' },
    })
    await page.goto('/')
    await expect(page.getByText('Er zijn nog geen samenvattingen')).toBeVisible()
    await noHorizontalScroll(page)
    await page.goto('/vergelijken')
    await expect(page.locator('main')).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'vergelijken')
  })

  for (const step of STEPS) {
    test(`pipeline step ${step}: no sideways scroll, navy accent only, icons are Material Symbols`, async ({ page, mockApi }) => {
      await mockApi({ ...PANEL_ROUTES, '/api/pipeline/status': step === 'insights' ? insightsPartial() : statusFixture('all-done') })
      await page.goto(`/pipeline-demo?step=${step}`)
      const panel = page.locator(`#step-panel-${step}`)
      await expect(panel.getByRole('heading', { level: 2 })).toBeVisible()
      await noHorizontalScroll(page)
      expect(await oldPaletteBackgrounds(page)).toEqual([])
      await expect(page.locator('main svg')).toHaveCount(0)
      const icons = page.locator('main .material-symbols-outlined')
      expect(await icons.count()).toBeGreaterThan(0)
      for (const tag of await icons.evaluateAll((els) => els.map((e) => e.tagName))) expect(tag).toBe('SPAN')
      await shot(page, `step-${step}`)
    })
  }
})

test.describe('visual: mockup boards', () => {
  test('Main: step 1 done with one to review', async ({ page, mockApi }) => {
    await mockApi({ ...PANEL_ROUTES, '/api/anonymize-report': REPORT, '/api/pipeline/status': statusFixture('anon-needs-review') })
    await page.goto('/pipeline-demo?step=anonymize')
    await expect(page.getByText('[MOGELIJKE NAAM]')).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'board-main')
  })

  test('Step2Running: a held vectors stream with a download', async ({ page, mockApi }) => {
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url
        if (!url.endsWith('/api/build-vectors') || init?.method !== 'POST') return realFetch(input, init)
        const enc = new TextEncoder()
        const stream = new ReadableStream({ start(c) { window.__pushEvent = (e) => c.enqueue(enc.encode(JSON.stringify(e) + '\n')) } })
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
      }
    })
    let started = false
    const running = statusFixture('vectors-running')
    running.active_job.progress = 12
    running.active_job.stage = 'download'
    await mockApi({ ...PANEL_ROUTES, '/api/pipeline/status': () => (started ? running : vectorsNext()) })
    await page.goto('/pipeline-demo?step=vectors')
    const panel = page.locator('#step-panel-vectors')
    await panel.getByRole('button', { name: 'Antwoorden doorzoekbaar maken', exact: true }).click()
    started = true
    await expect.poll(() => page.evaluate(() => typeof window.__pushEvent)).toBe('function')
    await page.evaluate((e) => window.__pushEvent(e), {
      status: 'progress', stage: 'download', progress: 12, message: 'fetching weights',
      params: { bytes_done: 0.4e9, bytes_total: 1.2e9, tier: 'balanced' },
    })
    await expect(panel.getByRole('progressbar')).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'board-step2-running')
  })

  test('Step 1 setup: upload, then choose columns (acceptance shots)', async ({ page, mockApi }) => {
    await mockApi({
      ...PANEL_ROUTES,
      '/api/pipeline/status': statusFixture('fresh'),
      '/api/word-blocklist': { words: ['Hogeschool X'] },
      'POST /api/inspect-file': { status: 'success', columns: ['Respondent', 'Wat vond je goed?', 'Wat kan beter?'], preview: [{ Respondent: '1', 'Wat vond je goed?': 'De lessen', 'Wat kan beter?': 'Roosters' }] },
    })
    await page.goto('/pipeline-demo?step=anonymize')
    const panel = page.locator('#step-panel-anonymize')
    await expect(panel.getByText('Sleep je bestand hierheen of klik om te kiezen')).toBeVisible()
    await noHorizontalScroll(page)
    expect(await oldPaletteBackgrounds(page)).toEqual([])
    await shot(page, 'step1-upload')
    await panel.locator('input[type=file]').setInputFiles({ name: 'enquete.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') })
    await expect(panel.getByRole('checkbox', { name: 'Wat vond je goed?' })).toBeChecked()
    await noHorizontalScroll(page)
    expect(await oldPaletteBackgrounds(page)).toEqual([])
    await shot(page, 'step1-columns')
  })

  test('Step3: check themes, not done yet', async ({ page, mockApi }) => {
    await mockApi({ ...PANEL_ROUTES, '/api/pipeline/status': rerankOpen() })
    await page.goto('/pipeline-demo?step=rerank')
    await expect(page.locator('#step-panel-rerank').getByRole('heading', { level: 2 })).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'board-step3')
  })

  test('Step4: write summaries, partly done', async ({ page, mockApi }) => {
    await mockApi({ ...PANEL_ROUTES, '/api/pipeline/status': insightsPartial() })
    await page.goto('/pipeline-demo?step=insights')
    const panel = page.locator('#step-panel-insights')
    await expect(panel.getByRole('heading', { name: 'Resultaten' })).toBeVisible()
    await expect(panel.locator('summary', { hasText: 'Geavanceerd' })).toHaveCount(1)
    await noHorizontalScroll(page)
    await shot(page, 'board-step4')
  })

  for (const [name, overview] of [
    ['empty', { json: { status: 'not_ready', reason: 'no_summaries' } }],
    ['not-ready', { json: { status: 'not_ready', reason: 'vectors' } }],
    ['offline', null],
  ]) {
    test(`Overview: ${name}`, async ({ page, mockApi }) => {
      if (overview) {
        await mockApi({
          '/api/pipeline/status': statusFixture('all-done'),
          '/api/filter-options': { status: 'success', options: {} },
          '/api/themes-overview': overview,
        })
      } else {
        await page.route('**/api/**', (route) => route.abort('connectionrefused'))
      }
      await page.goto('/')
      await expect(page.locator('main')).toBeVisible()
      await expect(page.getByText(/Er zijn nog geen samenvattingen|nog voorbereid|niet bereikbaar/).first()).toBeVisible()
      await noHorizontalScroll(page)
      // Let the filter bar's entrance fade finish before the shot.
      await page.waitForFunction(() => [...document.querySelectorAll('main > *')].every((el) => getComputedStyle(el).opacity === '1'))
      await shot(page, `board-overview-${name}`)
    })
  }

  test('Mobile: step 2 next, in English', async ({ page, mockApi }) => {
    test.skip(test.info().project.name !== 'mobile', '390 px board')
    await page.addInitScript(() => { try { localStorage.setItem('nse.lang', 'en') } catch { /* blocked */ } })
    await mockApi({ ...PANEL_ROUTES, '/api/pipeline/status': vectorsNext() })
    await page.goto('/pipeline-demo?step=vectors')
    await expect(page.getByRole('heading', { name: 'Analysis in 5 steps' })).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'board-mobile')
  })
})
