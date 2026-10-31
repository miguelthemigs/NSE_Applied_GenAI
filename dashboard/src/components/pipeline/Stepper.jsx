import { useRef, useState } from 'react'
import { PIPELINE_STEPS } from '../../config/pipelineSteps'
import { deriveStepView, stepPanelId, stepTabId } from '../../utils/stepView'
import { WARNING_STATES, displayState, labelTone, stateLabel } from '../../utils/stepLabel'
import { useI18n } from '../../i18n/I18nProvider'
import Icon from '../Icon'

const WARNING_ICON = { needs_review: 'warning', unverified: 'warning', interrupted: 'pause', stale: 'update' }

function StateCircle({ step, shown }) {
  const base = 'w-9 h-9 rounded-full flex items-center justify-center shrink-0 box-border'
  if (shown === 'done') {
    return (
      <span className={`${base} bg-primary text-on-primary`} aria-hidden="true">
        <Icon name="check" className="text-[20px]" />
      </span>
    )
  }
  if (shown === 'partial') {
    return (
      <span className="w-9 h-9 rounded-full shrink-0 box-border border-2 border-primary bg-surface-container-lowest overflow-hidden flex" aria-hidden="true">
        <span className="w-1/2 bg-primary" />
      </span>
    )
  }
  let ring = 'border-2 border-outline-variant text-outline'
  let content = <Icon name="lock" className="text-[18px]" />
  if (shown === 'in_progress') {
    ring = 'border-2 border-primary bg-surface-container-lowest text-primary'
    content = <Icon name="progress_activity" className="text-[20px] motion-safe:animate-spin" />
  } else if (shown === 'skipped') {
    ring = 'border-2 border-dashed border-outline text-outline'
    content = <Icon name="remove" className="text-[18px]" />
  } else if (WARNING_STATES.has(shown)) {
    ring = 'border-2 border-warning bg-surface-container-lowest text-warning'
    content = <Icon name={WARNING_ICON[shown]} className="text-[18px]" />
  } else if (shown === 'error') {
    ring = 'border-2 border-error bg-surface-container-lowest text-error'
    content = <Icon name="error" className="text-[18px]" />
  } else if (shown === 'ready') {
    ring = 'border-2 border-primary text-primary'
    content = <Icon name={step.icon} className="text-[18px]" />
  } else if (shown === 'next' || shown === 'not_started') {
    ring = shown === 'next'
      ? 'border-2 border-primary bg-surface-container-lowest text-primary'
      : 'border-2 border-outline-variant text-on-surface-variant'
    content = <span className="font-headline font-extrabold">{step.n}</span>
  }
  return <span className={`${base} ${ring}`} aria-hidden="true">{content}</span>
}

function Dots({ views, current }) {
  return (
    <span aria-hidden="true" className="flex gap-1.5 items-center">
      {PIPELINE_STEPS.map((step, i) => {
        const state = views[step.id].state
        const settled = state === 'done' || state === 'skipped' || state === 'ready'
        const prevSettled = i > 0 && ['done', 'skipped'].includes(views[PIPELINE_STEPS[i - 1].id].state)
        return (
          <span key={step.id} className="flex gap-1.5 items-center">
            {i > 0 && <span className={`w-[18px] h-0.5 ${prevSettled ? 'bg-primary' : 'bg-outline-variant'}`} />}
            {settled && step.id !== current ? (
              <span className="w-[22px] h-[22px] rounded-full bg-primary text-on-primary flex items-center justify-center">
                <Icon name="check" className="text-[14px]" />
              </span>
            ) : (
              <span className={`w-[22px] h-[22px] rounded-full border-2 box-border ${step.id === current ? 'border-primary bg-surface-container-lowest' : 'border-outline-variant'}`} />
            )}
          </span>
        )
      })}
    </span>
  )
}

/**
 * The 5-step progress bar. Every step can be opened (soft gating); its state
 * comes from the pipeline status. At 640 px and below it collapses to
 * "Stap {n} van 5" plus dots, and expands into a vertical list.
 */
export default function Stepper({ status, current, onSelect }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const tabRefs = useRef([])
  const toggleRef = useRef(null)
  const views = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, deriveStepView(status, s.id)]))
  // current is null while the first status loads: then no tab is selected yet.
  const currentStep = PIPELINE_STEPS.find((s) => s.id === current) ?? PIPELINE_STEPS[0]
  const currentView = views[currentStep.id]
  const currentLabel = stateLabel(t, status, currentStep, currentView, displayState(status, currentStep, currentView))
  const position = t('stepper.position', { n: currentStep.n, total: PIPELINE_STEPS.length })

  const onKeyDown = (e) => {
    const last = PIPELINE_STEPS.length - 1
    const i = tabRefs.current.indexOf(document.activeElement)
    if (i < 0) return
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="pipeline-stepper"
        onClick={() => setOpen((v) => !v)}
        className="min-[641px]:hidden w-full border border-outline-variant bg-surface-container-lowest rounded-2xl px-4 py-3.5 flex flex-col gap-2.5 text-left text-on-surface"
      >
        {/* One spoken name: "Stap 2 van 5 · {name} · {state}"; the visible parts are hidden from AT. */}
        <span className="sr-only">{[position, t('step.' + currentStep.id), currentLabel].join(' · ')}</span>
        <span aria-hidden="true" className="flex justify-between items-center w-full">
          <span className="text-[13px] font-bold text-on-surface-variant tracking-[0.04em] uppercase">{position}</span>
          <Icon name={open ? 'expand_less' : 'expand_more'} className="text-[20px] text-on-surface-variant" />
        </span>
        <span aria-hidden="true" className="font-bold text-base">{t('step.' + currentStep.id)}</span>
        <Dots views={views} current={currentStep.id} />
      </button>

      <div
        role="tablist"
        id="pipeline-stepper"
        aria-label={t('stepper.label')}
        aria-orientation={open ? 'vertical' : 'horizontal'}
        data-expanded={open}
        onKeyDown={onKeyDown}
        className={`${open ? 'grid' : 'hidden'} min-[641px]:grid grid-cols-1 min-[641px]:grid-cols-5 gap-2 bg-surface-container-lowest border border-outline-variant rounded-2xl p-3 min-[641px]:p-5`}
      >
        {PIPELINE_STEPS.map((step, i) => {
          const view = views[step.id]
          const shown = displayState(status, step, view)
          const selected = step.id === current
          const focusable = selected || (!current && i === 0)
          const selectedBg = WARNING_STATES.has(shown) ? 'bg-warning-container' : 'bg-primary-fixed'
          return (
            <button
              key={step.id}
              ref={(el) => { tabRefs.current[i] = el }}
              type="button"
              role="tab"
              id={stepTabId(step.id)}
              aria-selected={selected}
              aria-controls={stepPanelId(step.id)}
              tabIndex={focusable ? 0 : -1}
              onClick={() => {
                onSelect(step.id)
                // On small screens the list collapses again; keep focus on its toggle.
                if (open) {
                  setOpen(false)
                  toggleRef.current?.focus()
                }
              }}
              className={`min-h-[44px] rounded-[12px] p-3 text-left flex items-center gap-3 min-[641px]:flex-col min-[641px]:items-start min-[641px]:gap-2 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? selectedBg : 'hover:bg-surface-container-low'}`}
            >
              <StateCircle step={step} shown={shown} />
              <span className="flex flex-col gap-0.5 min-[641px]:gap-2 min-w-0">
                <span className={`text-sm leading-snug ${selected ? 'font-bold text-on-surface' : 'font-semibold text-on-surface-variant'}`}>
                  <span className="sr-only">{step.n}. </span>
                  {t('step.' + step.id)}
                </span>
                {' '}
                <span className={`text-[13px] ${labelTone(shown)}`}>{stateLabel(t, status, step, view, shown)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
