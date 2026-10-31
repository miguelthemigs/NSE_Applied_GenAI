/**
 * Helpers for the pipeline stepper in e2e specs.
 *
 *   statusFixture('fresh')        // parsed e2e/fixtures/status/fresh.json (a fresh copy)
 *   await stepTabs(page)          // the tablist; expands the collapsed control on small screens
 *   await selectStep(page, name)  // click the tab whose accessible name contains `name`
 */
import { readFileSync } from 'node:fs'

export function statusFixture(name) {
  return JSON.parse(readFileSync(new URL(`./status/${name}.json`, import.meta.url), 'utf8'))
}

/** The stepper tablist. At 640 px and below it first opens the collapsed "Stap n van 5" control. */
export async function stepTabs(page) {
  await page.locator('#pipeline-stepper').waitFor({ state: 'attached' })
  const toggle = page.locator('button[aria-controls="pipeline-stepper"]')
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const tabs = page.getByRole('tablist')
  await tabs.waitFor()
  return tabs
}

export async function selectStep(page, name) {
  const tabs = await stepTabs(page)
  await tabs.getByRole('tab', { name }).click()
}

/** Routes the step-1 panel requests on mount. */
export const ANON_ROUTES = {
  '/api/checkpoint-status': { has_checkpoint: false },
  '/api/anonymize-report': { has_report: false },
  '/api/word-blocklist': { words: [] },
}
