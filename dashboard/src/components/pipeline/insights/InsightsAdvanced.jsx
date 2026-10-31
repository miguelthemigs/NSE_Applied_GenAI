import { useState } from 'react'
import { useI18n } from '../../../i18n/I18nProvider'
import { postJson } from '../../../services/api'
import Icon from '../../Icon'
import { advancedBody, advancedDetails, advancedSummary } from '../stepStyles'

/** Answers per theme: 60, 240 (default) or all (null: the backend reads every answer). */
const DOC_OPTIONS = [
  { value: 60, key: 'ins.docs.fast' },
  { value: 240, key: 'ins.docs.default' },
  { value: null, key: 'ins.docs.all' },
]
/** Extra dimensions for the combinations, on top of year, location and programme. */
const EXTRA_DIMENSIONS = ['study_mode', 'language']

const legend = 'p-0 mb-2 font-semibold text-on-surface'
const option = 'flex items-center gap-2.5 min-h-[44px] cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:text-outline'

/**
 * Step 4 settings behind "Advanced", collapsed by default and closing the panel:
 * the technical model id (`model`, an AdvancedModelSelect), answers per theme,
 * study mode and language as extra dimensions, and clearing the saved summaries
 * (always after a confirmation). onCleared runs after a successful clear.
 */
export default function InsightsAdvanced({ model, maxDocuments, onMaxDocumentsChange, extraDims, onExtraDimsChange, combosOn, disabled = false, onCleared }) {
  const { t } = useI18n()
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState(null) // null | 'done' | 'failed'

  const toggleDim = (key) =>
    onExtraDimsChange(extraDims.includes(key) ? extraDims.filter((k) => k !== key) : [...extraDims, key])

  const clearCache = async () => {
    if (!window.confirm(t('insights.clearCache.confirm'))) return
    setNotice(null)
    setClearing(true)
    let ok = false
    try {
      const results = await Promise.all([postJson('/api/clear-cache'), postJson('/api/clear-subtheme-cache')])
      ok = results.every((r) => r.ok)
    } catch {
      ok = false
    }
    setClearing(false)
    setNotice(ok ? 'done' : 'failed')
    onCleared?.()
  }

  return (
    <details className={advancedDetails}>
      <summary className={advancedSummary}>
        <Icon name="tune" className="text-[18px]" />
        {t('action.advanced')}
      </summary>
      <div className={advancedBody}>
        {model}
        <fieldset className="m-0 p-0 border-0" disabled={disabled}>
          <legend className={legend}>{t('ins.docs.title')}</legend>
          <div className="flex flex-wrap gap-x-5">
            {DOC_OPTIONS.map((o) => (
              <label key={o.key} className={option}>
                <input
                  type="radio"
                  name="insights-max-documents"
                  checked={maxDocuments === o.value}
                  onChange={() => onMaxDocumentsChange(o.value)}
                  className="w-[18px] h-[18px] m-0 accent-primary"
                />
                {t(o.key, { n: o.value })}
              </label>
            ))}
          </div>
          <p className="m-0 text-on-surface-variant">{t('ins.docs.lead')}</p>
        </fieldset>

        <fieldset className="m-0 p-0 border-0" disabled={disabled || !combosOn}>
          <legend className={legend}>{t('insights.extraDims')}</legend>
          <div className="flex flex-wrap gap-x-5">
            {EXTRA_DIMENSIONS.map((key) => (
              <label key={key} className={option}>
                <input
                  type="checkbox"
                  checked={extraDims.includes(key)}
                  onChange={() => toggleDim(key)}
                  className="w-[18px] h-[18px] m-0 accent-primary"
                />
                {t('ins.dim.' + key)}
              </label>
            ))}
          </div>
          {!combosOn && <p className="m-0 text-on-surface-variant">{t('insights.extraDims.hint')}</p>}
        </fieldset>

        <div className="flex flex-col gap-2 items-start pt-4 border-t border-surface-container-highest">
          <button
            type="button"
            onClick={clearCache}
            disabled={disabled || clearing}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-[10px] border border-outline-variant bg-surface-container-lowest text-error text-sm font-semibold hover:bg-error-container disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="delete" className="text-[18px]" />
            {t('insights.clearCache')}
          </button>
          {notice && (
            <p role={notice === 'failed' ? 'alert' : 'status'} className={`m-0 ${notice === 'failed' ? 'text-error font-semibold' : 'text-on-surface-variant'}`}>
              {t(notice === 'failed' ? 'insights.clearCache.failed' : 'insights.clearCache.done')}
            </p>
          )}
        </div>
      </div>
    </details>
  )
}
