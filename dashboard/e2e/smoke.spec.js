import { test, expect, offline, noHorizontalScroll } from './fixtures/api.js'

test('overview offline: shows unreachable state, no error-as-theme, no NaN', async ({ page }) => {
  await offline(page)
  await page.goto('/')
  await expect(page.getByText(/niet bereikbaar/)).toBeVisible()
  const body = page.locator('body')
  await expect(body).not.toContainText(/NaN/)
  await expect(body).not.toContainText(/\berror\b/i)
  await noHorizontalScroll(page)
})

test('pipeline demo renders navigation with a mocked backend', async ({ page, mockApi }) => {
  await mockApi({})
  await page.goto('/pipeline-demo')
  await expect(page.locator('nav')).toBeVisible()
  await expect(page.locator('nav a[href="/pipeline-demo"]')).toBeVisible()
})
