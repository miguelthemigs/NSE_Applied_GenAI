import { DEFAULT_TIER, TIERS } from '../../config/modelTiers'
import { useI18n } from '../../i18n/I18nProvider'

/**
 * The technical model id under Advanced. Shows the tier's model until the user
 * picks another id; picking the tier's own model again clears the override.
 * `tiers` is the useModelTiers() result. Without a list (lookup failed) it
 * shows the id as text.
 */
export default function AdvancedModelSelect({ step, tier, tiers, advancedModelId = null, onAdvancedChange, disabled = false }) {
  const { t } = useI18n()
  const current = tiers.rows.find((r) => r.tier === tier)?.model_id ?? TIERS[DEFAULT_TIER][step]
  const shown = advancedModelId || current

  if (!onAdvancedChange || tiers.advanced.length === 0) {
    return <p className="m-0 break-all text-on-surface-variant">{t('ins.modelId', { id: shown })}</p>
  }
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="font-semibold text-on-surface">{t('common.model')}</span>
      <select
        value={shown}
        disabled={disabled}
        onChange={(e) => onAdvancedChange(e.target.value === current ? null : e.target.value)}
        className="w-full max-w-md min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface font-mono"
      >
        {tiers.advanced.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
    </label>
  )
}
