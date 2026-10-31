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
