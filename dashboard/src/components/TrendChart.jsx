import { useMemo } from 'react'
import { YEARS } from '../data/themes'
import Icon from './Icon.jsx'

const W = 340
const H = 160
const PAD = { top: 16, right: 16, bottom: 28, left: 28 }
const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top - PAD.bottom

function buildPath(data, maxVal) {
  return data
    .map((v, i) => {
      const x = PAD.left + (i / (data.length - 1)) * CHART_W
      const y = PAD.top + (1 - v / maxVal) * CHART_H
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}

function buildArea(data, maxVal) {
  const line = buildPath(data, maxVal)
  const lastX = PAD.left + CHART_W
  const firstX = PAD.left
  const bottom = PAD.top + CHART_H
  return `${line} L${lastX},${bottom} L${firstX},${bottom} Z`
}

export default function TrendChart({ activeTheme, allThemes }) {
  const topThemes = useMemo(() => {
    const sorted = [...allThemes].sort((a, b) => b.percentage - a.percentage).slice(0, 5)
    // ensure active theme is included
    if (activeTheme && !sorted.find((t) => t.id === activeTheme.id)) {
      sorted.pop()
      sorted.push(activeTheme)
    }
    return sorted
  }, [allThemes, activeTheme])

  const maxVal = useMemo(
    () => Math.max(...topThemes.flatMap((t) => t.trend)) + 2,
    [topThemes]
  )

  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  const COLORS = ['#002f59', '#006a6a', '#005119', '#b45309', '#727781']
  const ACTIVE_COLOR = '#002f59'

  return (
    <div className="bg-surface-container-low rounded-xl p-4 md:p-6 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base md:text-lg font-bold font-headline text-primary">Trend Analysis</h3>
        <Icon name="trending_up" className="text-outline text-xl" />
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Grid lines */}
        {gridLines.map((g) => {
          const y = PAD.top + g * CHART_H
          return (
            <line
              key={g}
              x1={PAD.left}
              y1={y}
              x2={PAD.left + CHART_W}
              y2={y}
              stroke="#c2c6d1"
              strokeOpacity="0.4"
              strokeWidth="1"
            />
          )
        })}

        {/* Lines */}
        {topThemes.map((theme, idx) => {
          const isActive = activeTheme && theme.id === activeTheme.id
          const color = isActive ? ACTIVE_COLOR : COLORS[idx % COLORS.length]
          const opacity = activeTheme ? (isActive ? 1 : 0.25) : 0.7
          const path = buildPath(theme.trend, maxVal)
          const area = buildArea(theme.trend, maxVal)

          return (
            <g key={theme.id}>
              {isActive && (
                <path d={area} fill={color} fillOpacity="0.08" />
              )}
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={isActive ? 2.5 : 1.5}
                strokeOpacity={opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: 'stroke-opacity 300ms, stroke-width 300ms' }}
              />
              {theme.trend.map((v, i) => {
                const x = PAD.left + (i / (theme.trend.length - 1)) * CHART_W
                const y = PAD.top + (1 - v / maxVal) * CHART_H
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={isActive ? 4 : 2.5}
                    fill={color}
                    fillOpacity={opacity}
                    style={{ transition: 'r 300ms, fill-opacity 300ms' }}
                  />
                )
              })}
            </g>
          )
        })}

        {/* X-axis labels */}
        {YEARS.map((year, i) => {
          const x = PAD.left + (i / (YEARS.length - 1)) * CHART_W
          return (
            <text
              key={year}
              x={x}
              y={H - 4}
              textAnchor="middle"
              fontSize="9"
              fill="#424750"
              fontFamily="Inter"
              fontWeight="600"
            >
              {year}
            </text>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {topThemes.map((theme, idx) => {
          const isActive = activeTheme && theme.id === activeTheme.id
          const color = isActive ? ACTIVE_COLOR : COLORS[idx % COLORS.length]
          return (
            <div
              key={theme.id}
              className="flex items-center gap-1.5 transition-opacity"
              style={{ opacity: activeTheme ? (isActive ? 1 : 0.35) : 1 }}
            >
              <span
                className="w-3 h-[2px] rounded-full inline-block"
                style={{ background: color }}
              />
              <span className="text-[10px] font-medium text-on-surface-variant">{theme.name}</span>
            </div>
          )
        })}
      </div>

      {activeTheme && (
        <p className="text-xs text-on-surface-variant italic">
          Theme '{activeTheme.name}' shows a growth of{' '}
          <span className="font-semibold text-primary">
            +{activeTheme.trend[activeTheme.trend.length - 1] - activeTheme.trend[0]}%
          </span>{' '}
          over the measured years.
        </p>
      )}
    </div>
  )
}
