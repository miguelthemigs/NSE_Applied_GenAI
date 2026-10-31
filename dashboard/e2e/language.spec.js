import { test, expect, noHorizontalScroll, offline } from './fixtures/api.js'
import { BANNED } from '../scripts/banned-copy.mjs'

test.describe('language toggle', () => {
  test('defaults to Dutch, switches to English and survives a reload', async ({ page, mockApi }) => {
    await mockApi({})
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl')
    const group = page.getByRole('group', { name: 'Taal' })
    await expect(group.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'true')
    await noHorizontalScroll(page)

    await group.getByRole('button', { name: 'EN' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const groupEn = page.getByRole('group', { name: 'Language' })
    await expect(groupEn.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    await noHorizontalScroll(page)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('group', { name: 'Language' })).toBeVisible()
  })
})

// ---- Plain-language copy on the Overview and the Pipeline, in both languages ----

const THEME_FIXTURE = {
  'Content and Organisation': ['Inhoud en organisatie', 'Content and organisation'],
  'Professional Practice': ['Beroepspraktijk', 'Professional practice'],
  Teachers: ['Docenten', 'Teachers'],
  'Support / Mentoring': ['Begeleiding en mentoring', 'Support and mentoring'],
  'Examination & Assessment': ['Toetsing en beoordeling', 'Examination and assessment'],
  'Engagement & Contact': ['Betrokkenheid en contact', 'Engagement and contact'],
  'Special Circumstances': ['Bijzondere omstandigheden', 'Special circumstances'],
}

const OVERVIEW_OK = {
  status: 'success',
  total_filtered_documents: 700,
  themes: Object.fromEntries(
    Object.keys(THEME_FIXTURE).map((name, i) => [
      name,
      {
        frequency: 140 - i * 15,
        vector_relevant_count: 140 - i * 15,
        summary: 'Fixture summary',
        subthemes: ['Planning'],
        subtheme_mentions: [{ subtheme: 'Planning', mentions: 5, percentage: 100 }],
        quotes: [],
        student_suggestions: [],
      },
    ]),
  ),
}

const FILTER_OPTIONS = {
  status: 'success',
  options: { academic_years: ['2024'], locations: [], programmes: [], study_modes: [], cohorts: [], sectors: [], languages: [] },
}

const PIPELINE_ROUTES = {
  '/api/status': { status: 'success', anonymized_exists: false, vector_db_exists: false },
  '/api/checkpoint-status': { has_checkpoint: false },
  '/api/anonymize-report': { has_report: false },
  '/api/word-blocklist': { words: [] },
}

async function expectCleanCopy(page) {
  const text = await page.locator('body').innerText()
  for (const b of BANNED) expect(text, `banned literal "${b}"`).not.toContain(b)
  expect(text, 'emoji in the UI').not.toMatch(/\p{Extended_Pictographic}/u)
}

async function switchTo(page, lang) {
  const name = lang === 'en' ? 'Language' : 'Taal'
  const other = lang === 'en' ? 'Taal' : 'Language'
  const label = lang.toUpperCase()
  const toggle = page.getByRole('group', { name: other })
  if (await toggle.count()) await toggle.getByRole('button', { name: label }).click()
  await expect(page.getByRole('group', { name })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', lang)
}

test.describe('overview and pipeline copy', () => {
  test('overview ok: theme names are translated in NL and EN, no banned copy or emoji', async ({ page, mockApi }) => {
    await mockApi({ ...PIPELINE_ROUTES, '/api/themes-overview': OVERVIEW_OK, '/api/filter-options': FILTER_OPTIONS })
    await page.goto('/')
    for (const [, [nl]] of Object.entries(THEME_FIXTURE)) {
      await expect(page.getByRole('heading', { name: nl, exact: true })).toBeVisible()
    }
    const nlText = await page.locator('body').innerText()
    for (const key of Object.keys(THEME_FIXTURE)) expect(nlText, `raw key "${key}" in NL`).not.toContain(key)
    await expect(page.getByRole('heading', { name: 'Thema\'s op volgorde van aantal reacties' })).toBeVisible()
    await expectCleanCopy(page)

    await switchTo(page, 'en')
    for (const [, [, en]] of Object.entries(THEME_FIXTURE)) {
      await expect(page.getByRole('heading', { name: en, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('heading', { name: 'Themes by number of comments' })).toBeVisible()
    await expectCleanCopy(page)
  })

  test('overview offline: Dutch and English offline text, no banned copy or emoji', async ({ page }) => {
    await offline(page)
    await page.goto('/')
    await expect(page.getByRole('status')).toHaveText('De analyse-service is niet bereikbaar. Start de app opnieuw.')
    await expectCleanCopy(page)
    await switchTo(page, 'en')
    await expect(page.getByRole('status')).toHaveText("The analysis service can't be reached. Restart the app.")
    await expectCleanCopy(page)
  })

  test('overview error: shows the error text, not the offline text, and keeps the detail behind a disclosure', async ({ page, mockApi }) => {
    await mockApi({
      '/api/filter-options': FILTER_OPTIONS,
      '/api/themes-overview': { status: 500, json: { status: 'error', error: 'kaboom-trace' } },
    })
    await page.goto('/')
    await expect(page.getByRole('status')).toHaveText('Er ging iets mis bij het laden van het overzicht.')
    await expect(page.getByText('kaboom-trace')).toBeHidden()
    await page.getByText('Details tonen').click()
    await expect(page.getByText('kaboom-trace')).toBeVisible()
  })

  test('pipeline: no banned copy or emoji in NL and EN', async ({ page, mockApi }) => {
    await mockApi(PIPELINE_ROUTES)
    await page.goto('/pipeline-demo')
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible()
    await expectCleanCopy(page)
    await switchTo(page, 'en')
    await expectCleanCopy(page)
  })
})

// ---- Every pipeline step and the routed detail/compare screens, NL and EN ----

const STEP_ROUTES = {
  ...PIPELINE_ROUTES,
  '/api/inspect-anonymized': { status: 'success', text_columns: ['Open antwoord'], row_count: 120 },
  '/api/vector-checkpoint-status': { has_checkpoint: true, processed_count: 40, total_docs: 120, embedding_model: 'Octen/Octen-Embedding-0.6B', selected_columns: ['Open antwoord'] },
  '/api/cache-status': { main_baseline: 7, main_filtered: 0, subtheme_baseline: 3, subtheme_filtered: 0 },
  '/api/vector-stats': { total_documents: 120 },
  '/api/filter-options': { status: 'success', options: { institutions: ['Fontys'], academic_years: ['2024'], locations: ['Eindhoven'], programmes: ['ICT'], study_modes: ['Voltijd'], cohorts: ['2023'], languages: ['Nederlands'] } },
}

const STEP_TABS = [
  ['1', 'Persoonsgegevens verwijderen', 'Remove personal details'],
  ['2', 'Antwoorden doorzoekbaar maken', 'Prepare answers for search'],
  ['3', "Thema's controleren", 'Double-check themes'],
  ['4', 'Samenvattingen schrijven', 'Write summaries'],
  ['5', 'Stel een vraag', 'Ask a question'],
]

test.describe('render coverage', () => {
  // Task 9 adds ?step=; until then the tab is clicked.
  test('every pipeline step is clean in NL and EN', async ({ page, mockApi }) => {
    await mockApi({ ...STEP_ROUTES, '/api/status': { status: 'success', anonymized_exists: true, vector_db_exists: true, vector_db_ready: true, theme_reranker_status: 'ready' } })
    await page.goto('/pipeline-demo')
    for (const lang of ['nl', 'en']) {
      if (lang === 'en') await switchTo(page, 'en')
      for (const [n, nl, en] of STEP_TABS) {
        const tab = page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: `${n}. ${lang === 'nl' ? nl : en}` })
        await tab.click()
        await expect(tab).toHaveClass(/border-blue-600/)
        await expectCleanCopy(page)
      }
    }
  })

  const THEME_PAYLOAD = {
    status: 'success',
    summary: 'Fixture summary',
    subthemes: ['Planning'],
    subtheme_mentions: [{ subtheme: 'Planning', mentions: 4, percentage: 100 }],
    quotes: ['Fixture quote about planning', 'Another planning comment'],
    student_suggestions: ['Plan the schedule earlier'],
    positive_comments: ['Planning works well'],
    critical_comments: ['Schedule changes too late'],
  }

  test('theme detail page is clean and translated in NL and EN', async ({ page, mockApi }) => {
    await mockApi({ ...STEP_ROUTES, '/api/theme-summary': THEME_PAYLOAD })
    await page.goto('/thema/content_org')
    await expect(page.getByRole('heading', { level: 1, name: 'Inhoud en organisatie' })).toBeVisible()
    await expect(page.getByText('Curriculum en planning')).toBeVisible()
    await expect(page.getByRole('button', { name: /echte reacties lezen/ }).first()).toBeVisible()
    await expectCleanCopy(page)
    await switchTo(page, 'en')
    await expect(page.getByRole('heading', { level: 1, name: 'Content and organisation' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Read \d+ real comments/ }).first()).toBeVisible()
    await expectCleanCopy(page)
  })

  test('sub-theme page is clean in NL and EN', async ({ page, mockApi }) => {
    await mockApi({ ...STEP_ROUTES, '/api/theme-summary': THEME_PAYLOAD })
    await page.goto('/thema/content_org/subtheme/Planning')
    await expect(page.getByRole('heading', { level: 1, name: 'Planning' })).toBeVisible()
    await expect(page.getByText('Subthema van Inhoud en organisatie')).toBeVisible()
    await expectCleanCopy(page)
    await switchTo(page, 'en')
    await expect(page.getByText('Sub-theme of Content and organisation')).toBeVisible()
    await expectCleanCopy(page)
  })

  test('compare page is clean in NL and EN', async ({ page, mockApi }) => {
    await mockApi(STEP_ROUTES)
    await page.route('**/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/v1/compare/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { group: 'Software Engineering', top_themes: [['Teachers', 5]], total_responses: 5 },
          { group: 'Cyber Security', top_themes: [], total_responses: 1 },
        ]),
      }),
    )
    await page.goto('/vergelijken')
    await expect(page.getByRole('heading', { level: 1, name: 'Vergelijking' })).toBeVisible()
    await expect(page.getByText('Docenten (5)')).toBeVisible()
    await expectCleanCopy(page)
    await switchTo(page, 'en')
    await expect(page.getByRole('heading', { level: 1, name: 'Comparison' })).toBeVisible()
    await expect(page.getByText('Teachers (5)')).toBeVisible()
    await expectCleanCopy(page)
  })
})
