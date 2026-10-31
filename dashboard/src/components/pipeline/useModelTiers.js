import { useEffect, useState } from 'react'
import { TIERS, TIER_KEYS } from '../../config/modelTiers'
import { getJson } from '../../services/api'

/** The three tiers without sizes or cache info: the picker stays usable when the lookup fails. */
export const fallbackRows = (step) => TIER_KEYS.map((tier) => ({ tier, model_id: TIERS[tier][step], size_bytes: null, cached: false }))

/**
 * GET /api/model-tiers for one step: `rows` (one per tier, in tier order) and
 * `advanced` (the technical model ids offered under Advanced). `skip` leaves the
 * fallback in place without a request (the caller already has the data).
 */
export default function useModelTiers(step, { skip = false } = {}) {
  const [rows, setRows] = useState(() => fallbackRows(step))
  const [advanced, setAdvanced] = useState([])

  useEffect(() => {
    if (skip) return undefined
    let cancelled = false
    getJson('/api/model-tiers')
      .then(({ ok, data }) => {
        if (cancelled || !ok || !Array.isArray(data?.tiers)) return
        const byTier = Object.fromEntries(data.tiers.filter((r) => r.step === step).map((r) => [r.tier, r]))
        setRows(TIER_KEYS.map((tier) => byTier[tier] ?? fallbackRows(step).find((r) => r.tier === tier)))
        setAdvanced(Array.isArray(data.advanced?.[step]) ? data.advanced[step] : [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [step, skip])

  return { rows, advanced }
}
