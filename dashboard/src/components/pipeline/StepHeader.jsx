import { PIPELINE_STEPS } from '../../config/pipelineSteps'
import { usePipelineStatus } from '../../context/PipelineStatusContext'
import { useI18n } from '../../i18n/I18nProvider'
import { badgeTone, displayState, stateLabel } from '../../utils/stepLabel'
import { deriveStepView } from '../../utils/stepView'
import Icon from '../Icon'

const STEP_BY_ID = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s]))

/**
 * The top of a step panel: icon tile, "STAP n VAN 5", the step name, its lead
 * and a state badge. Below 640 px the icon and badge share the first row.
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
    <div className="px-4 py-[18px] sm:p-6 flex flex-wrap gap-x-4 gap-y-2 items-start border-b border-surface-container-highest">
      <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-primary-fixed text-primary flex items-center justify-center shrink-0">
        <Icon name={step.icon} className="text-[22px]" />
      </span>
      <div className="max-sm:order-last basis-full sm:flex-[999_1_400px] flex flex-col gap-1 min-w-0">
        <span className="max-[640px]:hidden text-xs font-bold tracking-[0.08em] uppercase text-on-surface-variant">{eyebrow}</span>
        <h2 className="m-0 font-headline font-extrabold text-[21px] sm:text-2xl leading-tight text-primary break-words">{t('step.' + stepId)}</h2>
        <p className="m-0 text-sm sm:text-[15px] text-on-surface-variant">{t('step.' + stepId + '.lead')}</p>
      </div>
      {status && (
        <span className={`ml-auto text-xs sm:text-[13px] font-semibold px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full whitespace-nowrap ${badgeTone(shown)}`}>
          {stateLabel(t, status, step, view, shown, { optional: false })}
        </span>
      )}
    </div>
  )
}
