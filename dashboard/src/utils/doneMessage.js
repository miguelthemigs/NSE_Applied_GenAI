// Helpers for the Done card that closes each pipeline step.

/** Step states that show a Done card instead of the step's settings. */
export const DONE_CARD_STATES = new Set(['done', 'needs_review', 'unverified', 'stale'])

const TIERS = new Set(['quick', 'balanced', 'thorough'])

/** "Gebalanceerd (aanbevolen)" -> "Gebalanceerd": the sentence names the tier itself. */
export const shortTier = (label) => label.replace(/\s*\(.*\)\s*$/, '')

/** Short display name of a tier key, or '' when the tier is unknown. */
export const tierLabel = (tier, t) => (TIERS.has(tier) ? shortTier(t('tier.' + tier)) : '')

/**
 * The one-sentence result of a step, from its status summary
 * (GET /api/pipeline/status -> steps[stepId].summary).
 * Anonymisation never says "all clear" when the follow-up check was skipped.
 */
export function doneMessage(stepId, summary, t, formatNumber = String) {
  const s = summary ?? {}
  const num = (v) => formatNumber(Number.isFinite(Number(v)) ? Number(v) : 0)
  switch (stepId) {
    case 'anonymize': {
      const vars = { rows: num(s.rows), removed: num(s.removed), review: num(s.review) }
      if (s.verified === false) return t('done.anonymize.unverified', vars)
      return t(Number(s.review) > 0 ? 'done.anonymize' : 'done.anonymize.clear', vars)
    }
    case 'vectors': {
      const docs = num(s.documents)
      // Technical model ids stay under Advanced, so an unknown tier is left out.
      const tier = tierLabel(s.tier, t)
      return tier ? t('done.vectors', { docs, tier }) : t('done.vectors.noTier', { docs })
    }
    case 'rerank':
      return t('done.rerank', { checked: num(s.ambiguous), changed: num(s.changed), lowinfo: num(s.low_information) })
    case 'insights':
      return t('done.insights', { n: num(s.themes_done), total: num(s.themes_total) })
    default:
      return t('state.done')
  }
}

/** Why "Continue" is disabled in this step state, as a dictionary key; null when it is not. */
export function continueHintKey(state) {
  if (state === 'needs_review') return 'done.review.ackFirst'
  if (state === 'unverified') return 'done.unverified.checkFirst'
  return null
}
