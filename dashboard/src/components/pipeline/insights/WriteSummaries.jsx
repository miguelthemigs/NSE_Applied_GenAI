import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TIER, modelFor } from '../../../config/modelTiers'
import { usePipelineStatus } from '../../../context/PipelineStatusContext'
import { useNdjsonStream } from '../../../hooks/useNdjsonStream'
import { useI18n } from '../../../i18n/I18nProvider'
import { postJson } from '../../../services/api'
import { DONE_CARD_STATES, shortTier } from '../../../utils/doneMessage'
import { downloadFromEvent, llmErrorKey } from '../../../utils/downloadProgress'
import { deriveStepView } from '../../../utils/stepView'
import Icon from '../../Icon'
import DoneCard from '../DoneCard'
import GateReason from '../GateReason'
import ProgressPanel from '../ProgressPanel'
import TierPicker from '../TierPicker'
import InsightsAdvanced from './InsightsAdvanced'
import ResultsList from './ResultsList'

const LLM_PROVIDER = 'llama.cpp'
/** "Every combination of year, location and programme"; Advanced can add more. */
const COMBO_DIMENSIONS = ['academic_year', 'location', 'programme']
const CONFIRM_ABOVE = 500
const STAGES = ['load', 'read', 'process', 'save']
const stageIndex = (stage) => STAGES.indexOf(stage === 'download' ? 'load' : stage)

const primaryButton =
  'inline-flex items-center gap-2.5 min-h-[48px] px-[22px] py-3 rounded-xl bg-primary text-on-primary text-[15px] font-semibold hover:bg-primary-container disabled:bg-surface-container-highest disabled:text-on-surface-variant disabled:cursor-not-allowed'
const secondaryButton =
  'inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest text-primary text-sm font-semibold hover:bg-surface-container-low'

/** The backend's estimate ({count, minutes}) from /api/precompute-preview, or null. */
async function fetchEstimate(dims) {
  try {
    const { ok, data } = await postJson('/api/precompute-preview', { filter_dimensions: dims })
    const e = data?.estimate
    return ok && e && Number.isFinite(Number(e.count)) ? { count: Number(e.count), minutes: Number(e.minutes) || 0 } : null
  } catch {
    return null
  }
}

/**
 * Step 4: one "Write summaries" button (spec D10). A run starts the model
 * (start-stream: download and load), then POSTs /api/precompute-insights, all
 * behind one ProgressPanel. The combinations toggle shows the backend's
 * estimate and asks for confirmation above 500 summaries.
 */
export default function WriteSummaries({ onNavigate }) {
  const { t, formatNumber } = useI18n()
  const stream = useNdjsonStream()
  const { status, refresh } = usePipelineStatus()
  const view = deriveStepView(status, 'insights')
  const insights = status?.steps?.insights
  const vectorsAt = status?.steps?.vectors?.completed_at

  // Settings. An Advanced model id wins over the tier.
  const [tier, setTier] = useState(DEFAULT_TIER)
  const [advancedModel, setAdvancedModel] = useState(null)
  const selectedModel = modelFor('insights', tier, advancedModel)
  const modelName = advancedModel || shortTier(t('tier.' + tier))
  const [combosOn, setCombosOn] = useState(false)
  const [extraDims, setExtraDims] = useState([])
  const [maxDocuments, setMaxDocuments] = useState(240)
  const comboDims = [...COMBO_DIMENSIONS, ...extraDims]
  const comboKey = comboDims.join(',')
  const runDims = combosOn ? comboDims : []
  const [estimate, setEstimate] = useState(null)

  // The run. phase: idle | running | failed (the panel stays so its logs can be read).
  const [phase, setPhase] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const maxStage = useRef(-1)
  const [logs, setLogs] = useState([])
  const [download, setDownload] = useState(null)
  const [runError, setRunError] = useState(null) // {key, detail}
  const [rerunning, setRerunning] = useState(false) // settings instead of the Done card
  const [succeeded, setSucceeded] = useState(false)
  const [statusNotice, setStatusNotice] = useState(false)
  const [resultsKey, setResultsKey] = useState(0)
  const reloadResults = () => setResultsKey((k) => k + 1)

  useEffect(() => {
    if (!combosOn) return undefined
    let cancelled = false
    fetchEstimate(comboKey.split(',')).then((e) => { if (!cancelled) setEstimate(e && { ...e, key: comboKey }) })
    return () => { cancelled = true }
  }, [combosOn, comboKey, vectorsAt])
  // Only an estimate for exactly the chosen dimensions counts.
  const shownEstimate = combosOn && estimate?.key === comboKey ? estimate : null

  const log = (kind, text) => setLogs((prev) => [...prev, { kind, text }])
  const fail = (key, detail) => {
    setRunError({ key, detail })
    log('error', t('ins.log.error', { reason: detail || t(key) }))
  }
  // A stream may report `load` again mid-run; the stage bar never moves backwards.
  const advanceStage = (next) => {
    const idx = stageIndex(next)
    if (idx < 0 || idx < maxStage.current) return
    maxStage.current = idx
    setStage(next)
  }

  /** Download (if needed) and load the model. Resolves 'ready' | 'failed' | 'aborted'. */
  const startModel = async () => {
    const downloadTier = advancedModel ? null : tier
    let outcome = null
    try {
      await stream.start('/api/llm-models/start-stream', { model_id: selectedModel, provider: LLM_PROVIDER }, {
        onEvent: (data) => {
          if (data.status === 'progress') {
            setDownload(downloadFromEvent(data, downloadTier))
            if (data.stage) advanceStage(data.stage)
            if (data.message) log('info', data.message)
          } else if (data.status === 'success') {
            outcome = 'ready'
          } else if (data.status === 'error') {
            outcome = 'failed'
            fail(llmErrorKey(data.code) ?? 'error.llm_unavailable', data.error || data.message || '')
          }
        },
      })
    } catch (e) {
      if (e?.name === 'AbortError') return 'aborted'
      outcome = 'failed'
      fail(llmErrorKey(e.code) ?? 'error.llm_unavailable', e.message)
    } finally {
      setDownload(null)
    }
    // A stream that ends with neither success nor error (connection dropped) is a failure too.
    if (!outcome) {
      outcome = 'failed'
      fail('error.llm_unavailable', '')
    }
    return outcome
  }

  const run = async () => {
    if (!view.canStart || phase === 'running') return
    const dims = runDims
    if (dims.length > 0) {
      const est = shownEstimate ?? (await fetchEstimate(dims))
      if (est && est.count > CONFIRM_ABOVE) {
        const hours = formatNumber(Math.round((est.minutes / 60) * 10) / 10)
        if (!window.confirm(t('insights.confirmLarge', { count: formatNumber(est.count), hours }))) return
      }
    }

    setPhase('running')
    setRerunning(true)
    setSucceeded(false)
    setStatusNotice(false)
    setRunError(null)
    setDownload(null)
    setProgress(0)
    setStage('')
    maxStage.current = -1
    setLogs([{ kind: 'info', text: t('ins.log.start', { model: modelName }) }])

    const started = await startModel()
    if (started !== 'ready') {
      setPhase(started === 'aborted' ? 'idle' : 'failed')
      await refresh()
      return
    }

    const body = { precache_subthemes: true, filter_dimensions: dims, model_id: selectedModel, max_documents: maxDocuments }
    let ok = false
    let errored = false
    let sawEvent = false
    try {
      await stream.start('/api/precompute-insights', body, {
        onEvent: (data) => {
          if (!sawEvent) {
            sawEvent = true
            refresh()
            reloadResults()
          }
          if (data.status === 'progress') {
            if (Number.isFinite(data.progress)) setProgress((p) => Math.max(p, data.progress))
            if (data.stage) advanceStage(data.stage)
            if (data.message) log('info', `${data.theme ? `[${data.theme}] ` : ''}${data.message}`)
          } else if (data.status === 'success') {
            ok = true
            if (data.message) log('ok', data.message)
          } else if (data.status === 'error') {
            errored = true
            fail(llmErrorKey(data.code) ?? 'state.error', data.message || data.error || '')
          }
        },
      })
    } catch (e) {
      if (e?.name === 'AbortError') {
        setPhase('idle')
        return
      }
      errored = true
      setRunError({ key: 'state.error', detail: e.message })
      log('error', t('ins.log.connection', { reason: e.message }))
    }
    if (!ok && !errored) fail('state.error', '')

    // Keep the panel until the refreshed status shows the result (no blank step).
    const refreshed = await refresh()
    reloadResults()
    if (ok) {
      setRerunning(false)
      setSucceeded(true)
      if (!refreshed?.status) setStatusNotice(true)
      setPhase('idle')
    } else {
      setPhase('failed')
    }
  }

  const showDone = DONE_CARD_STATES.has(view.state) && phase === 'idle' && !rerunning
  const showSettings = phase === 'idle' && !showDone

  const filteredLabel = shownEstimate
    ? t('insights.filtered', { count: formatNumber(shownEstimate.count), min: formatNumber(shownEstimate.minutes) })
    : t('insights.filtered.label')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex gap-4 items-start pb-5 border-b border-surface-container-highest">
        <span className="w-11 h-11 rounded-xl bg-primary-fixed text-primary flex items-center justify-center shrink-0">
          <Icon name="summarize" className="text-[22px]" />
        </span>
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 font-headline font-extrabold text-2xl text-primary">{t('step.insights')}</h2>
          <p className="m-0 text-on-surface-variant">{t('step.insights.lead')}</p>
        </div>
      </header>

      {showDone && (
        <DoneCard
          stepId="insights"
          stepView={view}
          summary={insights?.summary}
          completedAt={insights?.completed_at}
          onRunAgain={() => { setSucceeded(false); setRerunning(true) }}
          onContinue={() => onNavigate?.('query')}
        >
          <ResultsList filterDimensions={runDims} reloadKey={resultsKey} />
        </DoneCard>
      )}

      {phase === 'failed' && runError && (
        <div role="alert" className="p-5 rounded-2xl bg-error-container text-on-error-container flex items-start gap-3">
          <Icon name="error" className="text-2xl shrink-0" />
          <div className="min-w-0">
            <p className="m-0 font-bold">{t(runError.key)}</p>
            {runError.detail && (
              <details className="mt-1 text-sm">
                <summary className="cursor-pointer">{t('action.details')}</summary>
                <p className="mt-1 break-words">{runError.detail}</p>
              </details>
            )}
          </div>
        </div>
      )}

      {statusNotice && !showDone && (
        <p role="alert" className="m-0 rounded-xl bg-error-container text-on-error-container px-4 py-3 font-medium">{t('pipeline.statusError')}</p>
      )}

      {/* A successful run that leaves step 4 partial still gets a confirmation. */}
      {succeeded && showSettings && (
        <div role="status" className="flex items-start gap-3 p-4 rounded-xl bg-success-container text-on-surface">
          <Icon name="check_circle" filled className="text-[22px] text-success shrink-0" />
          <div className="min-w-0">
            <p className="m-0 font-semibold">{t('state.done')}</p>
            <p className="m-0 text-sm text-on-surface-variant">{t('ins.done.main')}</p>
          </div>
        </div>
      )}

      {phase !== 'idle' && (
        <div className="flex flex-col gap-3">
          <ProgressPanel stage={stage} progress={progress} logs={logs} download={download ?? undefined} />
          {phase === 'failed' && (
            <button type="button" onClick={() => { setPhase('idle'); setRunError(null) }} className={`${secondaryButton} self-start`}>
              <Icon name="arrow_back" className="text-[18px]" />
              {t('ins.back')}
            </button>
          )}
        </div>
      )}

      {showSettings && (
        <>
          {DONE_CARD_STATES.has(view.state) && (
            <button type="button" onClick={() => setRerunning(false)} className={`${secondaryButton} self-start`}>
              <Icon name="arrow_back" className="text-[18px]" />
              {t('action.viewResults')}
            </button>
          )}

          <TierPicker
            step="insights"
            value={tier}
            advancedModelId={advancedModel}
            onChange={(next) => { setTier(next); setAdvancedModel(null) }}
            onAdvancedChange={(id) => setAdvancedModel(id)}
          />

          <label className="flex gap-3 items-start border border-outline-variant rounded-xl px-4 py-3.5 cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
            <input
              type="checkbox"
              checked={combosOn}
              onChange={(e) => setCombosOn(e.target.checked)}
              className="w-5 h-5 mt-0.5 m-0 shrink-0 accent-primary"
            />
            <span className="font-semibold text-on-surface">{filteredLabel}</span>
          </label>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" onClick={run} disabled={!view.canStart} className={primaryButton}>
              <Icon name="summarize" className="text-[20px]" />
              {t('insights.run')}
            </button>
            <GateReason stepId="insights" onNavigate={onNavigate} />
          </div>
        </>
      )}

      {!showDone && <ResultsList filterDimensions={runDims} reloadKey={resultsKey} />}

      {showSettings && (
        <InsightsAdvanced
          maxDocuments={maxDocuments}
          onMaxDocumentsChange={setMaxDocuments}
          extraDims={extraDims}
          onExtraDimsChange={setExtraDims}
          combosOn={combosOn}
          disabled={Boolean(status?.active_job)}
          onCleared={() => { refresh(); reloadResults() }}
        />
      )}
    </div>
  )
}
