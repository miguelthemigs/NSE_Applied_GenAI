import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DEFAULT_TIER, modelFor } from '../../../config/modelTiers'
import { usePipelineStatus } from '../../../context/PipelineStatusContext'
import { useNdjsonStream } from '../../../hooks/useNdjsonStream'
import { useI18n } from '../../../i18n/I18nProvider'
import { postJson } from '../../../services/api'
import { DONE_CARD_STATES, shortTier } from '../../../utils/doneMessage'
import { downloadFromEvent, llmErrorKey } from '../../../utils/downloadProgress'
import { gateErrorMessage } from '../../../utils/gateError'
import { deriveStepView } from '../../../utils/stepView'
import Icon from '../../Icon'
import DoneCard from '../DoneCard'
import GateReason from '../GateReason'
import ProgressPanel from '../ProgressPanel'
import TierPicker from '../TierPicker'
import AdvancedModelSelect from '../AdvancedModelSelect'
import StepHeader from '../StepHeader'
import useModelTiers from '../useModelTiers'
import { errorBox, primaryButton, secondaryButton, stepBody, stepFooterEnd } from '../stepStyles'
import InsightsAdvanced from './InsightsAdvanced'
import ResultsList from './ResultsList'

const LLM_PROVIDER = 'llama.cpp'
/** "Every combination of year, location and programme"; Advanced can add more. */
const COMBO_DIMENSIONS = ['academic_year', 'location', 'programme']
const CONFIRM_ABOVE = 500
const STAGES = ['load', 'read', 'process', 'save']
const stageIndex = (stage) => STAGES.indexOf(stage === 'download' ? 'load' : stage)

const runButton = `${primaryButton} min-h-[48px] px-[22px] py-3 gap-2.5 text-[15px]`

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
  const tiers = useModelTiers('insights')
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
  const [runError, setRunError] = useState(null) // {key, message?, detail}
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
  /** Show a failure: a translated key, or `message` (already translated, e.g. a 409 refusal). */
  const fail = (key, detail, message = null) => {
    setRunError({ key, message, detail })
    log('error', t('ins.log.error', { reason: detail || message || t(key) }))
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
      fail(llmErrorKey(e.code) ?? 'error.llm_unavailable', e.message, gateErrorMessage(t, e))
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
      setRunError({ key: 'state.error', message: gateErrorMessage(t, e), detail: e.message })
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

  const results = <ResultsList filterDimensions={runDims} reloadKey={resultsKey} />

  return (
    <>
      <StepHeader stepId="insights" />

      {showDone ? (
        <DoneCard
          stepId="insights"
          stepView={view}
          summary={insights?.summary}
          completedAt={insights?.completed_at}
          onRunAgain={() => { setSucceeded(false); setRerunning(true) }}
          onContinue={() => onNavigate?.('query')}
        >
          {results}
        </DoneCard>
      ) : (
        <>
          <div className={`${stepBody} gap-6`}>
            {phase === 'failed' && runError && (
              <div role="alert" className={errorBox}>
                <Icon name="error" className="text-[22px] shrink-0" />
                <div className="min-w-0">
                  <p className="m-0 font-bold">{runError.message ?? t(runError.key)}</p>
                  {runError.detail && (
                    <details className="mt-1 text-sm">
                      <summary className="cursor-pointer">{t('action.details')}</summary>
                      <p className="mt-1 break-words">{runError.detail}</p>
                    </details>
                  )}
                </div>
              </div>
            )}

            {statusNotice && (
              <p role="alert" className="m-0 rounded-[12px] bg-error-container text-on-error-container px-4 py-3 font-medium">{t('pipeline.statusError')}</p>
            )}

            {/* A successful run that leaves step 4 partial still gets a confirmation. */}
            {succeeded && showSettings && (
              <div role="status" className="flex items-start gap-3 p-4 rounded-[12px] bg-success-container text-on-surface">
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
                {phase === 'running' && <p className="m-0 text-sm text-on-surface-variant">{t('progress.browseNote')}</p>}
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
                  tiers={tiers}
                  showAdvanced={false}
                  advancedModelId={advancedModel}
                  onChange={(next) => { setTier(next); setAdvancedModel(null) }}
                  onAdvancedChange={(id) => setAdvancedModel(id)}
                />

                <label className="flex gap-3 items-start border border-outline-variant rounded-[12px] px-4 py-3.5 cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
                  <input
                    type="checkbox"
                    checked={combosOn}
                    onChange={(e) => setCombosOn(e.target.checked)}
                    className="w-5 h-5 mt-0.5 m-0 shrink-0 accent-primary"
                  />
                  <span className="font-semibold text-on-surface">{filteredLabel}</span>
                </label>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button type="button" onClick={run} disabled={!view.canStart} className={runButton}>
                    <Icon name="summarize" className="text-[20px]" />
                    {t('insights.run')}
                  </button>
                  <GateReason stepId="insights" onNavigate={onNavigate} />
                </div>
              </>
            )}

            {results}
          </div>

          <div className={stepFooterEnd}>
            <Link to="/" className={secondaryButton}>
              {t('action.openOverview')}
              <Icon name="arrow_forward" className="text-[18px]" />
            </Link>
          </div>

          {showSettings && (
            <InsightsAdvanced
              model={(
                <AdvancedModelSelect
                  step="insights"
                  tier={tier}
                  tiers={tiers}
                  advancedModelId={advancedModel}
                  onAdvancedChange={(id) => setAdvancedModel(id)}
                />
              )}
              maxDocuments={maxDocuments}
              onMaxDocumentsChange={setMaxDocuments}
              extraDims={extraDims}
              onExtraDimsChange={setExtraDims}
              combosOn={combosOn}
              disabled={Boolean(status?.active_job)}
              onCleared={() => { refresh(); reloadResults() }}
            />
          )}
        </>
      )}
    </>
  )
}
