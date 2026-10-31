import { test, expect, noHorizontalScroll } from './fixtures/api.js'

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
