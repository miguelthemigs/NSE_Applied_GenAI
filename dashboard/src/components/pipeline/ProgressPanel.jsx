import { useI18n } from '../../i18n/I18nProvider.jsx'
import Icon from '../Icon.jsx'
import StageProgress from './StageProgress.jsx'
import useEta from './useEta.js'

const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60))

/** "Gebalanceerd (aanbevolen)" -> "Gebalanceerd": the sentence adds "-model" itself. */
const shortTier = (label) => label.replace(/\s*\(.*\)\s*$/, '')

/**
 * Light progress card shared by all four steps. Render it only while a run is active.
 * `download` is {bytesDone, bytesTotal, tierKey, etaSeconds?}; bytesTotal null means unknown size.
 */
export default function ProgressPanel({ stage, progress = 0, etaSeconds, logs = [], download }) {
  const { t, formatBytes } = useI18n()
  const pct = Math.round(Math.min(100, Math.max(0, progress)))
  const computedEta = useEta(progress)
  const eta = etaSeconds ?? computedEta
  const downloadPct = download?.bytesTotal > 0 ? Math.min(100, Math.round((download.bytesDone / download.bytesTotal) * 100)) : null
  const computedDownloadEta = useEta(downloadPct ?? 0)
  const downloadEta = download?.etaSeconds > 0 ? download.etaSeconds : computedDownloadEta

  let downloadText = null
  if (download) {
    const tier = shortTier(t('tier.' + download.tierKey))
    if (download.bytesTotal > 0) {
      const text = t('download.running', {
        tier,
        done: formatBytes(download.bytesDone),
        total: formatBytes(download.bytesTotal),
        min: downloadEta ? minutes(downloadEta) : '',
      })
      // Without an honest estimate, drop the trailing "· about N min left" clause.
      downloadText = downloadEta ? text : text.split(' · ')[0]
    } else {
      downloadText = t('download.unknown', { tier })
    }
  }

  return (
    <div className="relative overflow-hidden bg-white border border-outline-variant rounded-2xl text-on-surface">
      <div className="h-1.5 bg-primary-fixed" aria-hidden="true">
        <div className="h-full bg-primary transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="p-5 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="m-0 font-semibold text-primary">
            {stage ? t('stage.' + (stage === 'download' ? 'load' : stage)) : t('state.working')}
          </p>
          <p className="m-0 text-sm text-on-surface-variant">
            <span className="font-bold text-primary text-base">{pct}%</span>
            {eta ? <span> · {t('progress.eta', { min: minutes(eta) })}</span> : null}
          </p>
        </div>

        <StageProgress current={stage} progress={progress} />

        {downloadText && (
          <div className="bg-surface-container-low rounded-xl p-4 flex flex-col gap-2.5">
            <div className="flex gap-2.5 items-center">
              <span className="w-8 h-8 rounded-lg bg-white text-primary flex items-center justify-center shrink-0">
                <Icon name="download" className="text-[18px]" />
              </span>
              <span className="font-semibold">{downloadText}</span>
            </div>
            {downloadPct !== null && (
              <div role="progressbar" aria-valuenow={downloadPct} aria-valuemin={0} aria-valuemax={100} aria-label={downloadText} className="h-2 rounded bg-primary-fixed overflow-hidden">
                <div className="h-full bg-primary rounded" style={{ width: `${downloadPct}%` }} />
              </div>
            )}
          </div>
        )}

        <details>
          <summary className="text-primary font-semibold cursor-pointer min-h-[44px] flex items-center">{t('action.details')}</summary>
          <pre className="m-0 mt-2 bg-surface-container-low text-on-surface-variant rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-56 overflow-y-auto">{logs.join('\n')}</pre>
        </details>
      </div>
    </div>
  )
}
