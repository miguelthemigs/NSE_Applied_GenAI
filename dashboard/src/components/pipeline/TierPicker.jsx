import { useId } from 'react'
import { DEFAULT_TIER } from '../../config/modelTiers'
import { useI18n } from '../../i18n/I18nProvider'
import { shortTier } from '../../utils/doneMessage'
import AdvancedModelSelect from './AdvancedModelSelect'
import useModelTiers from './useModelTiers'

const LEGEND = { vectors: 'vec.model.title', insights: 'ins.model.title' }

const chip = 'text-xs font-semibold px-2.5 py-1 rounded-full'

/**
 * "How thorough?" radio cards. `value` is the tier key; when `advancedModelId` is set the
 * user picked a technical model under Advanced, which wins, so no tier shows as selected.
 * onChange(tier, modelId) fires for a card; onAdvancedChange(modelId | null) for the Advanced list.
 * showAdvanced={false} leaves out the picker's own Advanced disclosure, for a step that puts the
 * model id in its single panel-wide Advanced (render AdvancedModelSelect there with the same
 * `tiers`, so the lookup runs once).
 */
export default function TierPicker({ step, value, onChange, advancedModelId = null, onAdvancedChange, disabled = false, showAdvanced = true, tiers: givenTiers }) {
  const { t, formatBytes } = useI18n()
  const name = useId()
  const ownTiers = useModelTiers(step, { skip: Boolean(givenTiers) })
  const tiers = givenTiers ?? ownTiers
  const { rows } = tiers

  const selected = advancedModelId ? null : value

  return (
    <fieldset className="m-0 p-0 border-0 flex flex-col gap-3" disabled={disabled}>
      <legend className="font-bold text-base text-on-surface p-0 mb-3">{t(LEGEND[step])}</legend>
      <div role="radiogroup" aria-label={t(LEGEND[step])} className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((row) => {
          const isSelected = selected === row.tier
          const size = formatBytes(row.size_bytes)
          return (
            <label
              key={row.tier}
              className={`flex flex-col gap-2 rounded-xl cursor-pointer min-w-0 ${isSelected ? 'border-2 border-primary bg-[#f5f9ff] p-[15px]' : 'border border-outline-variant bg-surface-container-lowest p-4 hover:bg-surface-container-low'} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary`}
            >
              <span className="flex items-center gap-2.5 flex-wrap">
                <input
                  type="radio"
                  name={name}
                  value={row.tier}
                  checked={isSelected}
                  onChange={() => onChange(row.tier, row.model_id)}
                  className="w-[18px] h-[18px] m-0 accent-primary"
                />
                <span className="font-bold text-base text-on-surface">{shortTier(t('tier.' + row.tier))}</span>
                {row.tier === DEFAULT_TIER && (
                  <span className="bg-primary text-on-primary text-[11px] font-bold px-2 py-0.5 rounded-full tracking-wide uppercase">{t('common.recommended')}</span>
                )}
              </span>
              <span className="text-sm text-on-surface-variant">{t('tier.' + row.tier + '.lead')}</span>
              <span className="flex gap-1.5 flex-wrap mt-1">
                {size && <span className={`${chip} text-on-surface-variant ${isSelected ? 'bg-surface-container-lowest border border-outline-variant' : 'bg-surface-container-low'}`}>{size}</span>}
                {row.cached ? (
                  <span className={`${chip} bg-success-container text-success`}>{t('tier.cached')}</span>
                ) : (
                  <span className={`${chip} bg-surface-container-low text-on-surface-variant`}>{shortTier(t('tier.download', { size }))}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      {showAdvanced && (
        <details className="text-sm text-on-surface-variant">
          <summary className="cursor-pointer font-semibold text-on-surface min-h-[44px] flex items-center">{t('action.advanced')}</summary>
          <AdvancedModelSelect step={step} tier={value} tiers={tiers} advancedModelId={advancedModelId} onAdvancedChange={onAdvancedChange} />
        </details>
      )}
    </fieldset>
  )
}
