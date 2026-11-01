import { REAL_THEME_META } from '../constants/realThemes'

// Classify a /api/themes-overview response. Only an ok response with a
// success body yields themes, and only keys of known themes survive.
export function parseThemesOverview(result) {
  if (result?.offline) return { kind: 'offline', themes: {} }
  const data = result?.data
  if (!result?.ok || !data || typeof data !== 'object') {
    return { kind: 'error', themes: {} }
  }
  if (data.status === 'not_ready') {
    return { kind: data.reason === 'no_summaries' ? 'no_summaries' : 'not_ready', themes: {} }
  }
  if (data.status !== 'success') return { kind: 'error', themes: {} }
  const themes = {}
  for (const [name, insight] of Object.entries(data.themes ?? {})) {
    if (Object.prototype.hasOwnProperty.call(REAL_THEME_META, name)) themes[name] = insight
  }
  return { kind: 'ok', themes }
}
