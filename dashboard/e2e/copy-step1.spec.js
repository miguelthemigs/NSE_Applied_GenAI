import { test, expect } from './fixtures/api.js'
import { ANON_ROUTES, statusFixture, stepTabs } from './fixtures/stepper.js'

const STEPS = {
  nl: ['Persoonsgegevens verwijderen', 'Antwoorden doorzoekbaar maken', "Thema's controleren", 'Samenvattingen schrijven', 'Stel een vraag'],
  en: ['Remove personal details', 'Prepare answers for search', 'Double-check themes', 'Write summaries', 'Ask a question'],
}
const BANNED = ['Drop your CSV', 'Vorige run', 'Check uitvoeren', 'Overslaan', 'not_run', 'Launch ', 'Vector DB', 'Reranker', 'Processing Stream', 'Data Anonymization Engine']

async function expectPlainSteps(page, names) {
  const tabs = await stepTabs(page)
  for (const [i, name] of names.entries()) {
    await expect(tabs.getByRole('tab', { name: `${i + 1}. ${name}` })).toBeVisible()
  }
  const text = await page.locator('body').innerText()
  for (const b of BANNED) expect(text, `banned literal "${b}"`).not.toContain(b)
}

test('pipeline shows plain step names in NL and EN, no banned copy', async ({ page, mockApi }) => {
  await mockApi({ '/api/pipeline/status': statusFixture('fresh'), ...ANON_ROUTES })
  await page.goto('/pipeline-demo')
  await expectPlainSteps(page, STEPS.nl)
  await expect(page.getByText('Sleep je bestand hierheen of klik om te kiezen')).toBeVisible()

  await page.getByRole('group', { name: 'Taal' }).getByRole('button', { name: 'EN' }).click()
  await expectPlainSteps(page, STEPS.en)
  await expect(page.getByText('Drag your file here or click to choose')).toBeVisible()
})

test('existing dataset: continue button goes to step 2', async ({ page, mockApi }) => {
  await mockApi({ '/api/pipeline/status': statusFixture('all-done'), ...ANON_ROUTES })
  await page.goto('/pipeline-demo?step=anonymize')
  await page.getByRole('tabpanel').getByRole('button', { name: 'Verder naar stap 2' }).click()
  await expect(page).toHaveURL(/\?step=vectors$/)
  const tabs = await stepTabs(page)
  await expect(tabs.getByRole('tab', { name: '2. Antwoorden doorzoekbaar maken' })).toHaveAttribute('aria-selected', 'true')
})
