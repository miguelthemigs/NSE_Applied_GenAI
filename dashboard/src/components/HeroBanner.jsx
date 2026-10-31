import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useI18n } from '../i18n/I18nProvider'
import { themeLabel } from '../constants/realThemes'

function AnimatedNumber({ value, label, icon, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-white/8 border border-white/10 backdrop-blur-sm min-w-[110px]"
    >
      <span
        className="material-symbols-outlined text-lg text-white/70"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
      <span className="text-2xl md:text-3xl font-extrabold font-headline text-white tabular-nums">
        {value}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">
        {label}
      </span>
    </motion.div>
  )
}

export default function HeroBanner({ themes, lastUpdated }) {
  const { t, formatNumber, formatDate } = useI18n()
  const updated = formatDate(lastUpdated)
  const totalComments = useMemo(() => {
    return themes.reduce((sum, th) => sum + (th.responseCount ?? th.percentage ?? 0), 0)
  }, [themes])

  const topTheme = useMemo(() => {
    if (themes.length === 0) return null
    return [...themes].sort((a, b) => (b.responseCount ?? b.percentage) - (a.responseCount ?? a.percentage))[0]
  }, [themes])

  const topName = topTheme ? themeLabel(t, topTheme.name) : ''

  const totalSubthemes = useMemo(() => {
    return themes.reduce((sum, th) => sum + (th.subthemes?.length ?? 0), 0)
  }, [themes])

  return (
    <motion.section
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl shadow-editorial"
      style={{
        background: 'linear-gradient(135deg, #001a33 0%, #002F59 40%, #00467F 100%)',
      }}
    >
      {/* Decorative grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
          backgroundSize: '24px 24px',
        }}
      />
      {/* Decorative glow */}
      <div
        className="absolute -top-20 -right-20 w-60 h-60 rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, #a3c9ff 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full opacity-15"
        style={{
          background: 'radial-gradient(circle, #90efef 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 p-5 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Left: Title */}
          <div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-xs font-bold uppercase tracking-widest text-white/50 mb-2 flex items-center gap-2"
            >
              <span
                className="material-symbols-outlined text-sm"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                insights
              </span>
              {t('overview.eyebrow')}
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="text-2xl md:text-3xl font-extrabold font-headline text-white leading-tight"
            >
              {t('overview.title')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-sm text-white/60 mt-2 max-w-md"
            >
              {t('overview.lead', { n: themes.length })}
            </motion.p>
            {updated && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="text-xs text-white/60 mt-2"
              >
                {t('done.updated', { date: updated })}
              </motion.p>
            )}

          </div>

          {/* Right: Stats */}
          <div className="flex flex-wrap gap-3">
            <AnimatedNumber
              value={formatNumber(totalComments)}
              label={t('overview.stat.comments')}
              icon="forum"
              delay={0.4}
            />
            <AnimatedNumber
              value={themes.length}
              label={t('overview.stat.themes')}
              icon="category"
              delay={0.5}
            />
            <AnimatedNumber
              value={totalSubthemes}
              label={t('overview.stat.subthemes')}
              icon="layers"
              delay={0.6}
            />
            {topTheme && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-white/8 border border-white/10 backdrop-blur-sm min-w-[110px]"
              >
                <span
                  className="material-symbols-outlined text-lg text-amber-300"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  trending_up
                </span>
                <span className="text-sm font-extrabold font-headline text-white text-center leading-tight">
                  {topName.length > 18 ? topName.slice(0, 16) + '…' : topName}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">
                  {t('overview.stat.top')}
                </span>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  )
}
