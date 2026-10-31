import { PIPELINE_STEPS } from '../../config/pipelineSteps'
import { useI18n } from '../../i18n/I18nProvider'
import { usePipelineStatus } from '../../context/PipelineStatusContext'
import { deriveStepView } from '../../utils/stepView'

const STEP_BY_ID = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s]))

/**
 * Why a step's main button is disabled, shown next to it as a link to the step
 * that matters:
 *   - a required step is not done: "Do step {n} first: {name} →" (gate.reason);
 *   - another step is running:     "Wait until step {n} has finished" (gate.busy).
 * Renders nothing when the step can start. `showBusy={false}` for steps that a
 * running job does not block (Ask a question).
 */
export default function GateReason({ stepId, onNavigate, showBusy = true, className = '' }) {
  const { t } = useI18n()
  const { status } = usePipelineStatus()
  const view = deriveStepView(status, stepId)
  const running = status?.active_job?.step

  let target = null
  let text = ''
  if (view.blockedBy && STEP_BY_ID[view.blockedBy]) {
    target = STEP_BY_ID[view.blockedBy]
    text = t('gate.reason', { n: target.n, name: t('step.' + target.id) })
  } else if (showBusy && running && running !== stepId && STEP_BY_ID[running]) {
    target = STEP_BY_ID[running]
    text = t('gate.busy', { n: target.n })
  }
  if (!target) return null

  return (
    <a
      href={`?step=${target.id}`}
      onClick={(e) => {
        e.preventDefault()
        onNavigate?.(target.id)
      }}
      className={`text-sm font-semibold text-primary underline underline-offset-[3px] hover:text-primary-container ${className}`.trim()}
    >
      {text}
    </a>
  )
}
