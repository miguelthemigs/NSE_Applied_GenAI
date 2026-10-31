import { PIPELINE_STEPS } from '../config/pipelineSteps'
import { firstOpenStep } from './stepView'

export const WARNING_STATES = new Set(['needs_review', 'unverified', 'interrupted', 'stale'])
const STEP_N = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s.n]))
const PRIMARY_STATES = new Set(['in_progress', 'partial', 'ready', 'next'])

/** 'next' is a display-only state: the first open step when it has not started yet. */
export function displayState(status, step, view) {
  if (view.state === 'not_started' && !view.blockedBy && status && firstOpenStep(status) === step.id) return 'next'
  return view.state
}

/** The short state text of a step ("Klaar", "Bezig… 12%", "Eerst stap 1 · optioneel"). */
export function stateLabel(t, status, step, view, shown, { optional = true } = {}) {
  const suffix = optional && step.optional ? ` · ${t('state.optional')}` : ''
  const summary = status?.steps?.[step.id]?.summary
  switch (shown) {
    case 'blocked':
      return t('state.blocked', { n: STEP_N[view.blockedBy] ?? step.n - 1 }) + suffix
    case 'next':
      return t('state.next') + suffix
    case 'not_started':
      return t('state.not_started') + suffix
    case 'in_progress': {
      const job = status?.active_job
      const pct = job?.step === step.id ? job.progress : null
      return typeof pct === 'number' ? t('state.in_progress', { pct: Math.round(pct) }) : t('state.working')
    }
    case 'partial':
      return t('state.partial', { x: summary?.themes_done ?? 0, y: summary?.themes_total ?? 0 })
    case 'needs_review':
      return t('state.needs_review', { n: summary?.review ?? 0 })
    default:
      return t('state.' + shown)
  }
}

/** Text colour for the state line under a stepper tab. */
export function labelTone(shown) {
  if (shown === 'done') return 'text-success font-semibold'
  if (WARNING_STATES.has(shown)) return 'text-warning font-semibold'
  if (shown === 'error') return 'text-error font-semibold'
  if (PRIMARY_STATES.has(shown)) return 'text-primary font-semibold'
  return 'text-outline'
}

/** Pill colours for the state badge in a step header. Status colours for status only. */
export function badgeTone(shown) {
  if (shown === 'done') return 'bg-success-container text-success'
  if (WARNING_STATES.has(shown)) return 'bg-warning-container text-warning'
  if (shown === 'error') return 'bg-error-container text-error'
  if (PRIMARY_STATES.has(shown)) return 'bg-primary-fixed text-primary'
  return 'bg-surface-container-low text-on-surface-variant'
}
