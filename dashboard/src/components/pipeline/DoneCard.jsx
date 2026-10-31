import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { PIPELINE_STEPS } from '../../config/pipelineSteps'
import { usePipelineStatus } from '../../context/PipelineStatusContext'
import { useI18n } from '../../i18n/I18nProvider'
import { postJson } from '../../services/api'
import { continueHintKey, doneMessage, tierLabel } from '../../utils/doneMessage'
import { isMet } from '../../utils/stepView'
import Icon from '../Icon'
import { primaryButton, secondaryButton, stepBody, stepFooter } from './stepStyles'

const STEP_N = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s.n]))
const NEXT_STEP = { anonymize: 'vectors', vectors: 'rerank', rerank: 'insights' }
const BY_TYPE = ['names', 'locations', 'numbers', 'health']
const WARNING_STATES = new Set(['unverified', 'stale'])

function Tile({ label, value }) {
  return (
    <div className="border border-outline-variant rounded-[12px] px-4 py-3.5 flex flex-col gap-0.5 min-w-0">
      <span className="text-[13px] text-on-surface-variant">{label}</span>
      <span className="font-headline font-extrabold text-[26px] leading-tight text-primary break-words">{value}</span>
    </div>
  )
}

function Tiles({ stepId, summary, completedAt }) {
  const { t, formatNumber, formatDate } = useI18n()
  const n = (v) => formatNumber(Number.isFinite(Number(v)) ? Number(v) : 0)
  let tiles = []
  if (stepId === 'anonymize') {
    tiles = BY_TYPE.map((k) => [t('done.type.' + k), n(summary?.by_type?.[k])])
  } else if (stepId === 'vectors') {
    const tier = tierLabel(summary?.tier, t)
    tiles = [[t('common.answers'), n(summary?.documents)]]
    if (tier) tiles.push([t('common.model'), tier])
    const updated = formatDate(completedAt)
    if (updated) tiles.push([t('done.tile.updated'), updated])
  } else if (stepId === 'rerank') {
    tiles = [
      [t('rerank.done.reread'), n(summary?.ambiguous)],
      [t('rerank.done.changed'), n(summary?.changed)],
      [t('rerank.done.lowinfo'), n(summary?.low_information)],
    ]
  }
  if (tiles.length === 0) return null
  const cols = tiles.length === 4 ? 'sm:grid-cols-4' : tiles.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
  return (
    <div className={`grid grid-cols-2 ${cols} gap-3`}>
      {tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}
    </div>
  )
}

/**
 * "I have reviewed the possible misses" (D7). The tick is saved server-side for
 * one specific report; Continue unlocks only once the status says so. The box
 * stays disabled until the list itself has loaded (listReady): nobody can
 * acknowledge a list they could not see.
 */
function ReviewGate({ summary, listReady, children }) {
  const { t, formatNumber } = useI18n()
  const { refresh, applyStatus } = usePipelineStatus()
  const titleId = useId()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState(null) // null | 'stale' | 'failed'
  const acknowledged = summary.acknowledged === true

  const acknowledge = async () => {
    setNotice(null)
    setPending(true)
    let res = null
    try {
      res = await postJson('/api/pipeline/acknowledge-review', { report_id: summary.report_id })
    } catch {
      res = null
    }
    if (!res?.ok) {
      // Untick first, then explain and fetch the list the backend has now.
      setPending(false)
      setNotice(res?.status === 409 && res.data?.code === 'error.stale_review' ? 'stale' : 'failed')
      await refresh()
      return
    }
    // Use the status the POST returned right away; the refresh then confirms
    // it. If neither gives a status, say so instead of unticking silently.
    const applied = applyStatus(res.data)
    const refreshed = await refresh()
    if (!applied && !refreshed?.status) setNotice('failed')
    setPending(false)
  }

  return (
    <section className="border border-warning/30 bg-warning-container rounded-[12px] p-4 flex flex-col gap-3" aria-labelledby={titleId}>
      <h3 id={titleId} className="m-0 flex items-center gap-2.5 text-warning font-bold text-[15px]">
        <Icon name="warning" className="text-[20px]" />
        {t('done.review.title', { n: formatNumber(Number(summary.review) || 0) })}
      </h3>
      <p className="m-0 text-on-surface">{t('done.review.lead')}</p>
      {children}
      <label className="flex gap-2.5 items-center font-semibold min-h-[44px] cursor-pointer has-[:disabled]:cursor-default">
        <input
          type="checkbox"
          checked={acknowledged || pending}
          disabled={pending || acknowledged || !listReady}
          onChange={(e) => { if (e.target.checked) acknowledge() }}
          className="w-5 h-5 m-0 accent-primary"
        />
        <span>{t('done.anonymize.ack')}</span>
      </label>
      {notice && (
        <p role="alert" className="m-0 rounded-[12px] bg-error-container text-on-error-container px-3 py-2 text-sm font-medium">
          {notice === 'stale' ? t('error.stale_review') : t('done.review.failed')}
        </p>
      )}
    </section>
  )
}

// The green check only for done / needs_review (as in the mockup, with the review
// box below); every other state fails closed to a warning icon.
const SUCCESS_STATES = new Set(['done', 'needs_review'])

function StateIcon({ state }) {
  const base = 'w-9 h-9 rounded-full flex items-center justify-center shrink-0'
  if (SUCCESS_STATES.has(state)) return <span className={`${base} bg-success text-on-primary`}><Icon name="check" className="text-[22px]" /></span>
  return (
    <span className={`${base} bg-surface-container-lowest text-warning border-2 border-warning`}>
      <Icon name={state === 'stale' ? 'update' : 'warning'} className="text-[20px]" />
    </span>
  )
}

/**
 * The result of a finished step, shown instead of the step's settings when its
 * state is done / needs_review / unverified / stale.
 *   - needs_review: the possibly-missed list (children) stays visible next to the
 *     acknowledge box, and Continue is disabled until the backend has the tick.
 *   - unverified: warning style, never a success check; offers the check (onRunCheck).
 *   - stale: warning style; continuing is still allowed.
 * Step 4 has no Continue: its primary action opens the Overview, and onContinue
 * becomes the secondary "Ask a question" (step 5).
 * listReady (anonymize only) must be true before the acknowledge box can be
 * ticked; it defaults to false so a caller that forgets it fails closed.
 * Renders the panel body (with `intro` on top) and the panel's footer bar.
 */
export default function DoneCard({ stepId, stepView, summary, completedAt, onContinue, onRunAgain, onRunCheck, listReady = false, intro, details, children }) {
  const { t, formatNumber, formatDate } = useI18n()
  const hintId = useId()
  const state = stepView?.state
  const warn = WARNING_STATES.has(state)
  const updated = formatDate(completedAt)
  const next = NEXT_STEP[stepId]
  const gated = !isMet(state)
  const hintKey = continueHintKey(state)
  const reviewable = stepId === 'anonymize' && summary?.verified !== false && Number(summary?.review) > 0

  return (
    <>
      <div className={stepBody}>
        {intro}
        <div data-state={state} className={`flex gap-3.5 items-start rounded-[12px] p-4 ${warn ? 'bg-warning-container' : 'bg-surface-container-low'}`}>
          <StateIcon state={state} />
          <div className="flex flex-col gap-1 min-w-0">
            {warn && <p className="m-0 font-bold text-warning">{t('state.' + state)}</p>}
            <p className="m-0 font-semibold text-base text-on-surface">{doneMessage(stepId, summary, t, formatNumber)}</p>
            {warn && <p className="m-0 text-sm text-on-surface">{t(`done.${state}.lead`)}</p>}
            {updated && <p className="m-0 text-[13px] text-on-surface-variant">{t('done.updated', { date: updated })}</p>}
            {state === 'unverified' && onRunCheck && (
              <button type="button" onClick={onRunCheck} disabled={!stepView?.canStart} className={`${primaryButton} self-start mt-2`}>
                <Icon name="fact_check" className="text-[18px]" />
                {t('action.runCheck')}
              </button>
            )}
          </div>
        </div>

        <Tiles stepId={stepId} summary={summary} completedAt={completedAt} />

        {reviewable ? <ReviewGate summary={summary} listReady={listReady}>{children}</ReviewGate> : children}

        {details}
      </div>

      <div className={stepFooter}>
        {onRunAgain ? (
          <button type="button" onClick={onRunAgain} className={secondaryButton}>
            <Icon name="refresh" className="text-[18px]" />
            {t('action.runAgain')}
          </button>
        ) : <span />}
        {stepId === 'insights' ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {onContinue && (
              <button type="button" onClick={onContinue} className={secondaryButton}>
                <Icon name="question_answer" className="text-[18px]" />
                {t('step.query')}
              </button>
            )}
            <Link to="/" className={primaryButton}>
              {t('action.openOverview')}
              <Icon name="arrow_forward" className="text-[18px]" />
            </Link>
          </div>
        ) : next ? (
          <div className="flex flex-wrap items-center justify-end gap-3 max-sm:w-full">
            {gated && hintKey && <span id={hintId} className="text-[13px] text-on-surface-variant">{t(hintKey)}</span>}
            <button
              type="button"
              onClick={onContinue}
              disabled={gated}
              aria-describedby={gated && hintKey ? hintId : undefined}
              className={`${primaryButton} max-sm:w-full`}
            >
              {t('action.continue', { n: STEP_N[next] })}
              <Icon name="arrow_forward" className="text-[18px]" />
            </button>
          </div>
        ) : null}
      </div>
    </>
  )
}
