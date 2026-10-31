import { PIPELINE_STEPS } from '../../config/pipelineSteps'
import { useI18n } from '../../i18n/I18nProvider'

/**
 * Shown next to a step's disabled main button: "Do step {n} first: {name} →",
 * as a link that opens the step that has to be done first. Renders nothing
 * when the step is not blocked.
 */
export default function GateReason({ view, onNavigate, className = '' }) {
  const { t } = useI18n()
  const step = PIPELINE_STEPS.find((s) => s.id === view?.blockedBy)
  if (!step) return null
  return (
    <a
      href={`?step=${step.id}`}
      onClick={(e) => {
        e.preventDefault()
        onNavigate?.(step.id)
      }}
      className={`text-sm font-semibold text-primary underline underline-offset-[3px] hover:text-primary-container ${className}`.trim()}
    >
      {t('gate.reason', { n: step.n, name: t('step.' + step.id) })}
    </a>
  )
}
