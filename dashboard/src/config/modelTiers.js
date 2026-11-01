import TIER_IDS from './modelTiers.json'

/**
 * Quick / Balanced / Most thorough (spec D8). TierPicker reads the live ids from
 * GET /api/model-tiers; these are the fallback when that lookup fails. The ids live in
 * modelTiers.json, which tests/test_model_downloads.py pins to src/config/model_tiers.py.
 */
export const TIER_KEYS = ['quick', 'balanced', 'thorough']
export const DEFAULT_TIER = 'balanced'

export const TIERS = TIER_IDS

export const isTier = (v) => TIER_KEYS.includes(v)

/** The model id a step sends: an Advanced id wins over the tier's id. */
export const modelFor = (step, tier, advancedId) => advancedId || TIERS[tier][step]
