import { PIPELINE_STEPS } from '../config/pipelineSteps'

const STEP_N = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s.n]))

/**
 * The translated message for a backend refusal to start a step (HTTP 409), or
 * null for any other error:
 *   - error.blocked: a required step is not done ({params.step});
 *   - error.busy:    another step is still running ({params.step}).
 * `err` is what useNdjsonStream().start() rejects with (it carries code/params).
 */
export function gateErrorMessage(t, err) {
  const step = err?.params?.step
  if (err?.code === 'error.blocked') {
    const id = STEP_N[step] ? step : 'anonymize'
    return t('error.blocked', { n: STEP_N[id], name: t('step.' + id) })
  }
  if (err?.code === 'error.busy') return t('gate.busy', { n: STEP_N[step] ?? '?' })
  return null
}
