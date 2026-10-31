import { PIPELINE_STEPS } from '../config/pipelineSteps'

// A requirement is met when its step is done, skipped, or stale (stale data is
// usable but marked). needs_review / unverified are deliberately NOT met: that
// is the privacy gate in front of steps 2 to 5.
const MET = new Set(['done', 'skipped', 'stale'])
// States that no longer need the user's attention when choosing where to open.
const SETTLED = new Set(['done', 'skipped', 'ready'])

const STEP_BY_ID = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s]))

/** True when a step in this state lets the next steps start (and "Continue" go on). */
export const isMet = (state) => MET.has(state)

function stateOf(status, stepId) {
  if (status?.active_job?.step === stepId) return 'in_progress'
  return status?.steps?.[stepId]?.state ?? 'not_started'
}

/**
 * The view of one step derived from GET /api/pipeline/status.
 * Gating looks at the required steps' states, never at the step's own state:
 * the backend keeps reporting a built vector DB as done even when step 1 is
 * unverified again.
 */
export function deriveStepView(status, stepId) {
  const step = STEP_BY_ID[stepId]
  let state = stateOf(status, stepId)
  let blockedBy = (step?.requires ?? []).find((req) => !MET.has(stateOf(status, req))) ?? null
  if (status && state === 'blocked' && !blockedBy) blockedBy = step?.requires?.[0] ?? null // fail closed
  // 'ready' (step 5) means usable, which a gated step is not.
  if (status && blockedBy && (state === 'not_started' || state === 'ready')) state = 'blocked'
  const canStart = Boolean(status) && !status.active_job && !blockedBy
  return { state, blockedBy: status ? blockedBy : null, canStart }
}

/** The step to open when no ?step= is given: the first one still needing attention. */
export function firstOpenStep(status) {
  if (!status) return PIPELINE_STEPS[0].id
  const open = PIPELINE_STEPS.find((s) => !SETTLED.has(stateOf(status, s.id)))
  return (open ?? PIPELINE_STEPS[PIPELINE_STEPS.length - 1]).id
}

/** DOM ids linking each stepper tab to its panel. */
export const stepTabId = (stepId) => `step-tab-${stepId}`
export const stepPanelId = (stepId) => `step-panel-${stepId}`
