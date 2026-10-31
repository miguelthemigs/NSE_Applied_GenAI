import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getThemeColor } from '../constants/themeColors'
import { themeLabel } from '../constants/realThemes'
import { useI18n } from '../i18n/I18nProvider'

export default function SubthemeWordCloud({ themes, empty = false, missingFilteredData = false }) {
  const { t } = useI18n()
  const words = useMemo(() => {
    if (empty || missingFilteredData) return []
    const list = []
    themes.forEach((th) => {
      const mentions = th.cachedInsight?.subtheme_mentions || th.subtheme_mentions || []
      mentions.forEach((m) => {
        const count = m.mentions || 0
        if (count <= 0) return
        list.push({
          text: m.subtheme,
          count,
          themeId: th.id,
          themeName: th.name,
        })
      })
    })
    return list.sort((a, b) => b.count - a.count).slice(0, 20)
  }, [themes, empty, missingFilteredData])

  const maxCount = useMemo(() => Math.max(...words.map((w) => w.count), 1), [words])
  const minCount = useMemo(() => Math.min(...words.map((w) => w.count), 0), [words])

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-5 md:p-6 shadow-ambient border border-outline-variant/10">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base md:text-lg font-bold font-headline text-primary">
            {t('cloud.title')}
          </h3>
          <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
            {t('cloud.lead')}
          </p>
        </div>
      </div>

      {empty ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 min-h-[120px] text-center">
          <span className="material-symbols-outlined text-3xl text-outline">layers_clear</span>
          <p className="text-sm font-bold text-primary">{t('cloud.noMatch.title')}</p>
          <p className="text-xs text-on-surface-variant/70">
            {t('cloud.noMatch.body')}
          </p>
        </div>
      ) : missingFilteredData ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 min-h-[120px] text-center">
          <span className="material-symbols-outlined text-3xl text-outline">cloud_off</span>
          <p className="text-sm font-bold text-primary">{t('cloud.missing.title')}</p>
          <p className="text-xs text-on-surface-variant/70">
            {t('cloud.missing.body')}
          </p>
        </div>
      ) : words.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 min-h-[120px] text-center">
          <span className="material-symbols-outlined text-3xl text-outline">cloud_off</span>
          <p className="text-sm font-bold text-primary">{t('cloud.none.title')}</p>
          <p className="text-xs text-on-surface-variant/70">
            {t('cloud.none.body')}
          </p>
        </div>
      ) : (
      <div className="flex flex-wrap items-center justify-center gap-2.5 py-4 min-h-[120px]">
        {words.map((word, idx) => {
          const colors = getThemeColor(word.themeId)
          const range = maxCount - minCount || 1
          const normalized = (word.count - minCount) / range
          const fontSize = 11 + normalized * 11
          const opacity = 0.55 + normalized * 0.45

          return (
            <Link
              key={`${word.themeId}-${word.text}`}
              to={`/thema/${word.themeId}/subtheme/${encodeURIComponent(word.text)}`}
              className="no-underline"
              onClick={() => window.scrollTo(0, 0)}
            >
              <motion.span
                initial={{ opacity: 0, scale: 0.7, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{
                  duration: 0.5,
                  delay: idx * 0.04,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer select-none
                           hover:scale-110 transition-transform duration-200"
                style={{
                  fontSize: `${fontSize}px`,
                  color: colors.accent,
                  opacity,
                  backgroundColor: colors.bgTint,
                  border: `1px solid ${colors.border}`,
                  fontWeight: normalized > 0.5 ? 700 : 600,
                  fontFamily: "'Manrope', sans-serif",
                }}
                title={t('cloud.tooltip', { word: word.text, n: word.count, theme: themeLabel(t, word.themeName) })}
              >
                {word.text}
                <span
                  className="text-[9px] font-bold opacity-60 tabular-nums"
                  style={{ color: colors.accent }}
                >
                  {word.count}
                </span>
              </motion.span>
            </Link>
          )
        })}
      </div>
      )}
    </div>
  )
}
