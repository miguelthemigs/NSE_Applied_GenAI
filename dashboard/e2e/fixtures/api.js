import { test as base, expect } from '@playwright/test'

// Origin the frontend talks to (mirrors API_BASE in src/services/api.js).
export const API_ORIGIN = process.env.VITE_API_BASE ?? 'http://localhost:5001'
export const API_GLOB = `${API_ORIGIN}/api/**`

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
}

function fulfillBody(route, value) {
  if (value && Array.isArray(value.ndjson)) {
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/x-ndjson',
      body: value.ndjson.map((e) => JSON.stringify(e)).join('\n') + '\n',
    })
  }
  return route.fulfill({
    status: value?.__status ?? 200,
    headers: CORS,
    contentType: 'application/json',
    body: JSON.stringify(value),
  })
}

/**
 * Fixture `mockApi(routes)`.
 *   routes: { '/api/path': object | {ndjson: [events]} | (route, request) => any }
 * A function may fulfil the route itself (return undefined after calling
 * route.fulfill) or return a value, which is sent as JSON/NDJSON.
 * Unlisted /api/ paths answer 404. Every intercepted request is recorded:
 *   mockApi.requests          -> [{ method, path, body }]
 *   mockApi.requestsTo(path, method?)
 */
export const test = base.extend({
  mockApi: async ({ page }, use) => {
    const requests = []
    const api = async (routes = {}) => {
      await page.route(API_GLOB, async (route, request) => {
        const url = new URL(request.url())
        let body = null
        try {
          body = request.postDataJSON()
        } catch {
          body = request.postData()
        }
        const method = request.method()
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
        requests.push({ method, path: url.pathname, body })
        const handler = routes[url.pathname]
        if (handler === undefined) {
          return route.fulfill({
            status: 404,
            headers: CORS,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'not mocked' }),
          })
        }
        if (typeof handler === 'function') {
          let handled = false
          const wrapped = {
            ...route,
            fulfill: (...a) => ((handled = true), route.fulfill(...a)),
            abort: (...a) => ((handled = true), route.abort(...a)),
            continue: (...a) => ((handled = true), route.continue(...a)),
          }
          const result = await handler(wrapped, request)
          if (handled) return
          return fulfillBody(route, result)
        }
        return fulfillBody(route, handler)
      })
    }
    Object.defineProperty(api, 'requests', { get: () => requests })
    api.requestsTo = (path, method) =>
      requests.filter((r) => r.path === path && (!method || r.method === method))
    await use(api)
  },
})

export { expect }

/** Abort every /api/ request (backend unreachable). */
export async function offline(page) {
  await page.route(API_GLOB, (route) => route.abort('connectionrefused'))
}

/** Assert the page does not scroll horizontally. */
export async function noHorizontalScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
}
