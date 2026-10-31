import { test, expect, offline, API_ORIGIN } from './fixtures/api.js'

test.describe('mockApi harness', () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop', 'harness self-test runs once')
  })

  // Page must be on the app origin so fetch to the API origin is cross-origin like the app.
  const call = (page, path, init) =>
    page.evaluate(
      async ([url, init]) => {
        const r = await fetch(url, init)
        return { status: r.status, text: await r.text() }
      },
      [`${API_ORIGIN}${path}`, init],
    )

  test('records requests and answers 404 for unlisted paths', async ({ page, mockApi }) => {
    await mockApi({ '/api/ok': { a: 1 } })
    await page.goto('/pipeline-demo')
    const ok = await call(page, '/api/ok')
    const missing = await call(page, '/api/nope')
    expect(JSON.parse(ok.text)).toEqual({ a: 1 })
    expect(missing.status).toBe(404)
    expect(mockApi.requestsTo('/api/ok')).toHaveLength(1)
    expect(mockApi.requestsTo('/api/nope')).toHaveLength(1)
    expect(mockApi.requests.map((r) => r.path)).toEqual(expect.arrayContaining(['/api/ok', '/api/nope']))
  })

  test('serves NDJSON with status', async ({ page, mockApi }) => {
    await mockApi({ '/api/stream': { ndjson: [{ n: 1 }, { n: 2 }] } })
    await page.goto('/pipeline-demo')
    const res = await call(page, '/api/stream')
    expect(res.status).toBe(200)
    expect(res.text.trim().split('\n').map((l) => JSON.parse(l))).toEqual([{ n: 1 }, { n: 2 }])
  })

  test('function handler can read the request through the real route', async ({ page, mockApi }) => {
    await mockApi({
      '/api/echo': (route) => ({ got: route.request().postDataJSON() }),
    })
    await page.goto('/pipeline-demo')
    const res = await call(page, '/api/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 42 }),
    })
    expect(JSON.parse(res.text)).toEqual({ got: { x: 42 } })
    expect(mockApi.requestsTo('/api/echo', 'POST')[0].body).toEqual({ x: 42 })
  })

  test('method-specific keys win, calls are additive, bare undefined gives 500', async ({ page, mockApi }) => {
    await mockApi({ '/api/thing': { m: 'any' }, 'POST /api/thing': { status: 202, json: { m: 'post' } } })
    await mockApi({ '/api/bad': () => undefined })
    await page.goto('/pipeline-demo')
    expect(JSON.parse((await call(page, '/api/thing')).text)).toEqual({ m: 'any' })
    const post = await call(page, '/api/thing', { method: 'POST' })
    expect(post.status).toBe(202)
    expect(JSON.parse(post.text)).toEqual({ m: 'post' })
    const bad = await call(page, '/api/bad')
    expect(bad.status).toBe(500)
    expect(bad.text).toContain('returned undefined')
  })

  test('offline aborts and records attempts', async ({ page }) => {
    const attempted = await offline(page)
    await page.goto('/pipeline-demo')
    const failed = await page.evaluate(
      (url) => fetch(url).then(() => false, () => true),
      `${API_ORIGIN}/api/x`,
    )
    expect(failed).toBe(true)
    expect(attempted.map((r) => r.path)).toContain('/api/x')
  })
})
