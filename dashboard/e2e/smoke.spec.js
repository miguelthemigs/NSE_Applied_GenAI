import { test, expect, offline, noHorizontalScroll } from './fixtures/api.js'

test('overview offline: no error-as-theme, no NaN', async ({ page }) => {
  await offline(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible()
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/NaN/)
  expect(text).not.toMatch(/\berror\b/i)
  await noHorizontalScroll(page)
})

test('pipeline demo renders navigation with a mocked backend', async ({ page, mockApi }) => {
  await mockApi({})
  await page.goto('/pipeline-demo')
  await expect(page.locator('nav')).toBeVisible()
  await expect(page.locator('nav a[href="/pipeline-demo"]')).toBeVisible()
})
