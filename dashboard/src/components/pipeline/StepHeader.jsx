import { PIPELINE_STEPS } from '../../config/pipelineSteps'
import { usePipelineStatus } from '../../context/PipelineStatusContext'
import { useI18n } from '../../i18n/I18nProvider'
import { badgeTone, displayState, stateLabel } from '../../utils/stepLabel'
import { deriveStepView } from '../../utils/stepView'
import Icon from '../Icon'

const STEP_BY_ID = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s]))

/**
 * The top of a step panel: icon tile, "STAP n VAN 5", the step name, its lead
 * and a state badge. Below 640 px (max-sm) the icon and badge share the first row and the
 * eyebrow is hidden: the collapsed stepper already says "Stap n van 5".
 * The badge has no live role: progress is announced by the progress panel.
 */
export default function StepHeader({ stepId }) {
  const { t } = useI18n()
  const { status } = usePipelineStatus()
  const step = STEP_BY_ID[stepId]
  const view = deriveStepView(status, stepId)
  const shown = displayState(status, step, view)
  const eyebrow = t('stepper.position', { n: step.n, total: PIPELINE_STEPS.length }) + (step.optional ? ` · ${t('state.optional')}` : '')

  return (
    <div className="max-sm:px-4 max-sm:py-[18px] p-6 flex flex-wrap gap-x-4 gap-y-2 items-start border-b border-surface-container-highest">
      <span className="max-sm:w-10 max-sm:h-10 w-11 h-11 rounded-[12px] bg-primary-fixed text-primary flex items-center justify-center shrink-0">
        <Icon name={step.icon} className="text-[22px]" />
      </span>
      <div className="max-sm:order-last max-sm:basis-full sm:flex-[999_1_400px] flex flex-col gap-1 min-w-0">
        <span className="max-sm:hidden text-xs font-bold tracking-[0.08em] uppercase text-on-surface-variant">{eyebrow}</span>
        <h2 className="m-0 font-headline font-extrabold max-sm:text-[21px] text-2xl leading-tight text-primary break-words">{t('step.' + stepId)}</h2>
        <p className="m-0 max-sm:text-sm text-[15px] text-on-surface-variant">{t('step.' + stepId + '.lead')}</p>
      </div>
      {status && (
        <span className={`ml-auto max-sm:text-xs text-[13px] font-semibold max-sm:px-2.5 px-3 max-sm:py-1 py-1.5 rounded-full whitespace-nowrap ${badgeTone(shown)}`}>
          {stateLabel(t, status, step, view, shown, { optional: false })}
        </span>
      )}
    </div>
  )
}
