import { describe, it, expect } from 'vitest'
import { parseThemesOverview } from './overviewResponse'
import { REAL_THEME_META } from '../constants/realThemes'

const KNOWN = Object.keys(REAL_THEME_META)[0]

describe('parseThemesOverview', () => {
  it('treats an error body as error, never as themes', () => {
    const r = parseThemesOverview({ ok: false, data: { status: 'error', error: 'boom' } })
    expect(r.kind).toBe('error')
    expect(r.themes).toEqual({})
  })
  it('treats a non-ok response as error even if it has themes', () => {
    const r = parseThemesOverview({ ok: false, data: { themes: { [KNOWN]: {} } } })
    expect(r.kind).toBe('error')
    expect(r.themes).toEqual({})
  })
  it('drops unknown keys from a success body', () => {
    const r = parseThemesOverview({
      ok: true,
      data: { status: 'success', themes: { [KNOWN]: {}, error: {}, status: {} } },
    })
    expect(r.kind).toBe('ok')
    expect(Object.keys(r.themes)).toEqual([KNOWN])
  })
  it('maps not_ready / no_summaries', () => {
    const notReady = parseThemesOverview({ ok: true, data: { status: 'not_ready', reason: 'vectors_not_ready', themes: {} } })
    expect(notReady.kind).toBe('not_ready')
    const none = parseThemesOverview({ ok: true, data: { status: 'not_ready', reason: 'no_summaries', themes: {} } })
    expect(none.kind).toBe('no_summaries')
    expect(none.themes).toEqual({})
  })
  it('offline when fetch rejected', () => {
    expect(parseThemesOverview({ offline: true }).kind).toBe('offline')
  })
  it('malformed body is an error', () => {
    expect(parseThemesOverview({ ok: true, data: null }).kind).toBe('error')
  })
})
