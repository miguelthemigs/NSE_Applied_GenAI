/**
 * Quick / Balanced / Most thorough (spec D8). Mirrors src/config/model_tiers.py; the
 * ids here are the offline fallback when GET /api/model-tiers cannot be loaded.
 */
export const TIER_KEYS = ['quick', 'balanced', 'thorough']
export const DEFAULT_TIER = 'balanced'

export const TIERS = {
  quick: { vectors: 'Octen/Octen-Embedding-0.6B', insights: 'unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL' },
  balanced: { vectors: 'Octen/Octen-Embedding-0.6B', insights: 'unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL' },
  thorough: { vectors: 'Octen/Octen-Embedding-4B', insights: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL' },
}

export const isTier = (v) => TIER_KEYS.includes(v)

/** The model id a step sends: an Advanced id wins over the tier's id. */
export const modelFor = (step, tier, advancedId) => advancedId || TIERS[tier][step]
