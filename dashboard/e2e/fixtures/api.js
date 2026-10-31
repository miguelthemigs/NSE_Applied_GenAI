/**
 * Mocked-backend fixture for e2e specs. No spec ever needs the real backend.
 *
 *   test('x', async ({ page, mockApi }) => {
 *     await mockApi({ '/api/status': {...}, 'POST /api/build': {status: 202, json: {}} })
 *     mockApi.requests            // [{ method, path, body }] in arrival order
 *     mockApi.requestsTo('/api/build', 'POST')
 *   })
 *
 * Route keys: '/api/path' (any method) or 'METHOD /api/path' (wins over path-only).
 * Route values:
 *   - plain object/array          -> 200 JSON
 *   - { json, status? }           -> JSON with status (default 200)
 *   - { ndjson: [events], status? } -> newline-delimited JSON stream
 *   - (route, request) => value   -> function; returns any of the above, or fulfils
 *                                    `route` itself (then returns undefined). Returning
 *                                    undefined without fulfilling answers 500.
 * Unlisted /api/ paths answer 404. mockApi is additive: repeated calls merge into
 * one routes map (later keys override earlier ones).
 * `offline(page)` aborts every /api/ request and returns the attempted requests array.
 * Helpers: noHorizontalScroll(page).
 */
import { test as base, expect } from '@playwright/test'

// Origin the frontend talks to; playwright.config.js passes it to the dev server
// as VITE_API_BASE so the app and the mock cannot disagree.
export const API_ORIGIN = process.env.VITE_API_BASE ?? 'http://localhost:5001'
export const API_GLOB = `${API_ORIGIN}/api/**`

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
}

function isEnvelope(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && ('json' in v || 'ndjson' in v)
}

function respond(route, value) {
  const env = isEnvelope(value) ? value : { json: value }
  if (Array.isArray(env.ndjson)) {
    return route.fulfill({
      status: env.status ?? 200,
      headers: CORS,
      contentType: 'application/x-ndjson',
      body: env.ndjson.map((e) => JSON.stringify(e)).join('\n') + '\n',
    })
  }
  return route.fulfill({
    status: env.status ?? 200,
    headers: CORS,
    contentType: 'application/json',
    body: JSON.stringify(env.json),
  })
}

function readBody(request) {
  try {
    return request.postDataJSON()
  } catch {
    return request.postData()
  }
}

// Real Route behind a thin wrapper that notes when the handler fulfilled/aborted it.
function trackRoute(route) {
  const tracked = Object.create(route)
  tracked.handled = false
  for (const m of ['fulfill', 'abort', 'continue', 'fallback']) {
    tracked[m] = (...a) => {
      tracked.handled = true
      return route[m](...a)
    }
  }
  return tracked
}

export const test = base.extend({
  mockApi: async ({ page }, use) => {
    const requests = []
    const routes = {}
    let installed = false

    const install = () =>
      page.route(API_GLOB, async (route, request) => {
        const { pathname } = new URL(request.url())
        const method = request.method()
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
        requests.push({ method, path: pathname, body: readBody(request) })

        const key = `${method} ${pathname}` in routes ? `${method} ${pathname}` : pathname
        if (!(key in routes)) {
          return route.fulfill({
            status: 404,
            headers: CORS,
            contentType: 'application/json',
            body: JSON.stringify({ error: `not mocked: ${method} ${pathname}` }),
          })
        }
        const handler = routes[key]
        if (typeof handler !== 'function') return respond(route, handler)

        const tracked = trackRoute(route)
        const result = await handler(tracked, request)
        if (tracked.handled) return
        if (result === undefined) {
          return route.fulfill({
            status: 500,
            headers: CORS,
            contentType: 'application/json',
            body: JSON.stringify({
              error: `mock handler for "${key}" returned undefined without fulfilling the route`,
            }),
          })
        }
        return respond(route, result)
      })

    const api = async (more = {}) => {
      Object.assign(routes, more)
      if (!installed) {
        installed = true
        await install()
      }
    }
    Object.defineProperty(api, 'requests', { get: () => requests })
    api.requestsTo = (path, method) =>
      requests.filter((r) => r.path === path && (!method || r.method === method))
    await use(api)
  },
})

export { expect }

/** Abort every /api/ request (backend unreachable). Returns the attempted requests. */
export async function offline(page) {
  const attempted = []
  await page.route(API_GLOB, (route, request) => {
    attempted.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: readBody(request),
    })
    return route.abort('connectionrefused')
  })
  return attempted
}

/** Assert the page does not scroll horizontally. */
export async function noHorizontalScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
}
