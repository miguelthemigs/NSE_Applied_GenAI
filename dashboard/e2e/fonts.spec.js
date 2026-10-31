import { test, expect } from './fixtures/api.js'

for (const path of ['/', '/pipeline-demo']) {
  test(`no Google Fonts requests on ${path}`, async ({ page, mockApi }) => {
    await mockApi({})
    const external = []
    page.on('request', (req) => {
      const host = new URL(req.url()).hostname
      if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') external.push(req.url())
    })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(external).toEqual([])
  })
}
