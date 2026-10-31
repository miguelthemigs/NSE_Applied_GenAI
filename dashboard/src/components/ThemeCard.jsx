import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getThemeColor } from '../constants/themeColors'
import { themeLabel, themeText } from '../constants/realThemes'
import { useI18n } from '../i18n/I18nProvider'
import Icon from './Icon.jsx'

function MiniDonutChart({ subthemeMentions, accentColor }) {
  if (!subthemeMentions || subthemeMentions.length === 0) return null

  const radius = 16
  const strokeWidth = 5
  const circ = 2 * Math.PI * radius // ~100.5

  const baseColor = accentColor || '#002F59'
  const colors = [
    baseColor,
    `${baseColor}cc`,
    `${baseColor}99`,
    `${baseColor}66`,
    `${baseColor}44`,
  ]
  // Highest percentage gets the darkest shade
  const sorted = [...subthemeMentions]
    .filter(sm => (sm.percentage || 0) > 0)
    .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))

  let currentOffset = 0

  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="transform -rotate-90 shrink-0">
      {/* Background circle */}
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="transparent"
        stroke="#E6E8EE"
        strokeWidth={strokeWidth}
      />
      {sorted.map((sm, idx) => {
        const strokeLength = (sm.percentage / 100) * circ
        const offset = currentOffset
        currentOffset += strokeLength
        const color = colors[idx % colors.length]

        return (
          <circle
            key={sm.subtheme}
            cx="20"
            cy="20"
            r={radius}
            fill="transparent"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${Math.max(0, strokeLength - 1.5)} ${circ}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        )
      })}
    </svg>
  )
}

export default function ThemeCard({ theme, size, filters, index = 0 }) {
  const location = useLocation()
  const { t } = useI18n()
  const name = themeLabel(t, theme.name)
  const subtag = themeText(t, theme.name, 'subtag', theme.subtag)
  const description = themeText(t, theme.name, 'desc', theme.description)
  const transition = { type: 'spring', stiffness: 300, damping: 30 }
  const subthemeMentions = theme.cachedInsight?.subtheme_mentions || theme.subtheme_mentions || []
  const colors = getThemeColor(theme.id)

  const cardVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.97 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.5,
        delay: index * 0.08,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  }

  if (size === 'large') {
    return (
      <Link
        to={{ pathname: `/thema/${theme.id}`, search: location.search }}
        state={{ theme, filters }}
        onClick={() => window.scrollTo(0, 0)}
        className="block no-underline font-sans"
      >
        <motion.div
          layout
          layoutId={theme.id}
          transition={transition}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="rounded-2xl p-5 md:p-6 flex flex-col justify-between
                     hover:shadow-lg min-h-[185px] transition-all duration-300 group
                     border backdrop-blur-sm"
          style={{
            backgroundColor: colors.bgTint,
            borderColor: colors.border,
            borderLeftWidth: '4px',
            borderLeftColor: colors.accent,
          }}
          whileHover={{
            scale: 1.02,
            backgroundColor: colors.bgHover,
            boxShadow: `0 12px 40px ${colors.border}`,
          }}
        >
          <div className="flex justify-between items-start gap-4">
            <div className="flex flex-col gap-2">
              <Icon name={theme.icon} filled className="text-3xl" style={{ color: colors.accent }} />
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded w-fit"
                style={{
                  backgroundColor: colors.accentLight,
                  color: colors.accent,
                  border: `1px solid ${colors.border}`,
                }}
              >
                {t('overview.card.comments', { n: theme.responseCount ?? theme.percentage })}
              </span>
            </div>
            {/* SVG Pie Chart */}
            <MiniDonutChart subthemeMentions={subthemeMentions} accentColor={colors.accent} />
          </div>
          <div className="mt-4">
            <h3
              className="text-lg md:text-xl font-bold font-headline text-on-surface transition-colors"
            >
              {name}
            </h3>
            {subtag && (
              <p className="text-xs text-on-surface-variant/80 mt-1">{subtag}</p>
            )}
            {description && (
              <p className="text-xs leading-relaxed text-on-surface-variant mt-3 line-clamp-2">
                {description}
              </p>
            )}
          </div>
        </motion.div>
      </Link>
    )
  }

  // small card
  return (
    <Link
      to={{ pathname: `/thema/${theme.id}`, search: location.search }}
      state={{ theme, filters }}
      onClick={() => window.scrollTo(0, 0)}
      className="block no-underline font-sans"
    >
      <motion.div
        layout
        layoutId={theme.id}
        transition={transition}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="rounded-xl p-4 flex flex-col justify-between
                   hover:shadow-lg min-h-[145px] transition-all duration-300 group
                   border backdrop-blur-sm"
        style={{
          backgroundColor: colors.bgTint,
          borderColor: colors.border,
          borderLeftWidth: '3px',
          borderLeftColor: colors.accent,
        }}
        whileHover={{
          scale: 1.03,
          backgroundColor: colors.bgHover,
          boxShadow: `0 8px 32px ${colors.border}`,
        }}
      >
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col gap-1.5">
            <Icon name={theme.icon} filled className="text-2xl" style={{ color: colors.accent }} />
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit"
              style={{
                backgroundColor: colors.accentLight,
                color: colors.accent,
                border: `1px solid ${colors.border}`,
              }}
            >
              {t('overview.card.comments', { n: theme.responseCount ?? theme.percentage })}
            </span>
          </div>
          {/* Mini SVG Pie Chart */}
          <MiniDonutChart subthemeMentions={subthemeMentions} accentColor={colors.accent} />
        </div>
        <div className="mt-3">
          <h3
            className="text-sm font-bold font-headline leading-tight text-on-surface transition-colors"
          >
            {name}
          </h3>
          {subtag && (
            <p className="text-[10px] text-on-surface-variant/70 mt-0.5">{subtag}</p>
          )}

          {description && (
            <p className="text-[10px] leading-snug text-on-surface-variant mt-2 line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </motion.div>
    </Link>
  )
}
