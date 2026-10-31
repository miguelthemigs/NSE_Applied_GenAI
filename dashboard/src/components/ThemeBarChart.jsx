import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { getThemeColor, THEME_COLOR_LIST } from '../constants/themeColors'
import Icon from './Icon.jsx'

export default function ThemeBarChart({ themes }) {
  const sorted = useMemo(() => {
    return [...themes].sort((a, b) => (b.responseCount ?? b.percentage) - (a.responseCount ?? a.percentage))
  }, [themes])

  const maxVal = useMemo(() => {
    return Math.max(...sorted.map((t) => t.responseCount ?? t.percentage), 1)
  }, [sorted])

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-5 md:p-6 shadow-ambient border border-outline-variant/10">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base md:text-lg font-bold font-headline text-primary">
            Theme Distribution
          </h3>
          <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
            Comments per theme — ranked by frequency
          </p>
        </div>
        <Icon name="bar_chart" filled className="text-xl text-outline" />
      </div>

      <div className="flex flex-col gap-3">
        {sorted.map((theme, idx) => {
          const count = theme.responseCount ?? theme.percentage
          const pct = maxVal > 0 ? (count / maxVal) * 100 : 0
          const colors = getThemeColor(theme.id)

          return (
            <div key={theme.id} className="group">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Icon name={theme.icon} filled className="text-base" style={{ color: colors.accent }} />
                  <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors">
                    {theme.name}
                  </span>
                </div>
                <span className="text-xs font-extrabold tabular-nums" style={{ color: colors.accent }}>
                  {count}
                </span>
              </div>
              <div className="h-3 w-full bg-surface-container-high rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: colors.gradient }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, pct)}%` }}
                  transition={{ duration: 0.8, delay: idx * 0.08, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
