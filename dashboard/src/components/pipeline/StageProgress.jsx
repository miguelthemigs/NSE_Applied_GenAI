import { useI18n } from '../../i18n/I18nProvider.jsx'

const DEFAULT_STAGES = ['load', 'read', 'process', 'save']

/** Four-segment stage bar. 'download' counts as part of 'load'. */
export default function StageProgress({ stages = DEFAULT_STAGES, current, progress = 0 }) {
  const { t } = useI18n()
  const key = current === 'download' ? 'load' : current
  const idx = stages.indexOf(key)
  const done = progress >= 100
  return (
    <ol className="grid gap-2 m-0 p-0 list-none" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((stage, i) => {
        const complete = done || (idx >= 0 && i < idx)
        const active = !done && i === idx
        const fill = complete ? 100 : active ? Math.min(100, Math.max(8, progress)) : 0
        return (
          <li key={stage} className="flex flex-col gap-1.5" aria-current={active ? 'step' : undefined}>
            <div className="h-1.5 rounded-sm bg-surface-container-highest overflow-hidden">
              <div className="h-full bg-primary transition-all duration-200" style={{ width: `${fill}%` }} />
            </div>
            <span className={`text-[13px] ${complete || active ? 'font-bold text-primary' : 'text-outline'}`}>{t('stage.' + stage)}</span>
          </li>
        )
      })}
    </ol>
  )
}
