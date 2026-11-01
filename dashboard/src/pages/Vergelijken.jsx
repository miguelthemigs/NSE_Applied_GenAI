import { useState } from 'react'
import { PROGRAMMES, COMPARISON_DATA, COMPARISON_LABELS } from '../data/themes'
import { useApiData } from '../hooks/useApiData'
import { useI18n } from '../i18n/I18nProvider'
import { themeLabel } from '../constants/realThemes'
import Icon from '../components/Icon'

const THEME_KEYS = Object.keys(COMPARISON_LABELS)

function MirroredRow({ label, valueA, valueB, maxVal = 5 }) {
  const pctA = (valueA / maxVal) * 100
  const pctB = (valueB / maxVal) * 100
  const diff = Math.abs(valueA - valueB)
  const significant = diff >= 0.4

  return (
    <div className="grid grid-cols-11 items-center gap-1">
      {/* Left bar (A) */}
      <div className="col-span-5 flex justify-end">
        <div className="w-full bg-surface-container-lowest h-9 rounded-l-full overflow-hidden flex justify-end items-center px-4 relative">
          <div
            className="absolute right-0 top-0 bottom-0 transition-all duration-500"
            style={{ width: `${pctA}%`, background: 'rgba(0,47,89,0.18)' }}
          />
          <span className="relative z-10 text-sm font-bold text-primary">{valueA.toFixed(1)}</span>
        </div>
      </div>

      {/* Centre label */}
      <div className="col-span-1 text-center">
        <span
          className={`text-[9px] font-bold uppercase leading-none block ${
            significant ? 'text-primary' : 'text-on-surface-variant/50'
          }`}
        >
          {label}
        </span>
        {significant && (
          <span className="text-[8px] font-bold text-error block mt-0.5">
            Δ{diff.toFixed(1)}
          </span>
        )}
      </div>

      {/* Right bar (B) */}
      <div className="col-span-5">
        <div className="w-full bg-surface-container-lowest h-9 rounded-r-full overflow-hidden flex justify-start items-center px-4 relative">
          <div
            className="absolute left-0 top-0 bottom-0 transition-all duration-500"
            style={{ width: `${pctB}%`, background: 'rgba(0,106,106,0.18)' }}
          />
          <span className="relative z-10 text-sm font-bold text-secondary">{valueB.toFixed(1)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Live pipeline section ─────────────────────────────────────────────────────
function LiveCompareSection({ compare }) {
  const { t, formatNumber } = useI18n()
  if (!compare || compare.length === 0) return null

  return (
    <div className="mt-10 bg-surface-container-lowest rounded-2xl p-6 md:p-10 shadow-ambient border border-outline-variant/10">
      <div className="flex items-center gap-2 mb-6">
        <Icon name="hub" filled className="text-base text-tertiary-container" />
        <h2 className="text-base font-bold font-headline text-primary">
          {t('compare.live.title')}
        </h2>
        <span className="ml-auto text-xs font-medium text-tertiary-container bg-tertiary-container/10 px-2 py-0.5 rounded-full">
          {t('compare.live')}
        </span>
      </div>

      {/* Top themes per programme */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {compare.map((row) => (
          <div key={row.group} className="bg-surface-container-low rounded-xl p-4">
            <p className="text-xs font-bold text-primary mb-2 truncate">{row.group}</p>
            <p className="text-[10px] text-on-surface-variant mb-2 uppercase tracking-wider">{t('compare.topThemes')}</p>
            <div className="flex flex-wrap gap-1.5">
              {(row.top_themes ?? []).slice(0, 5).map(([theme, count]) => (
                <span
                  key={theme}
                  className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium"
                >
                  {themeLabel(t, theme)} ({count})
                </span>
              ))}
              {(!row.top_themes || row.top_themes.length === 0) && (
                <span className="text-[10px] text-on-surface-variant italic">{t('compare.noData')}</span>
              )}
            </div>
            <p className="text-[10px] text-on-surface-variant/60 mt-2">
              {t('compare.responses', { n: formatNumber(row.total_responses ?? 0) })}
            </p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-on-surface-variant/40 mt-4">
        {t('compare.source', { time: new Date().toLocaleTimeString() })}
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Vergelijken() {
  const { t } = useI18n()
  const [selA, setSelA] = useState('se')
  const [selB, setSelB] = useState('cs')

  const progA = PROGRAMMES.find((p) => p.id === selA)
  const progB = PROGRAMMES.find((p) => p.id === selB)
  const dataA = COMPARISON_DATA[selA]
  const dataB = COMPARISON_DATA[selB]

  // Fetch live compare data (no filters — show all programmes)
  const { compare, isLive, loading } = useApiData({})

  // Sort rows by largest difference
  const sortedKeys = [...THEME_KEYS].sort(
    (a, b) => Math.abs(dataB[b] - dataA[b]) - Math.abs(dataB[a] - dataA[a])
  )

  const biggestDiffKey = sortedKeys.reduce((best, k) =>
    Math.abs(dataA[k] - dataB[k]) > Math.abs(dataA[best] - dataB[best]) ? k : best
  )

  return (
    <main className="max-w-[1280px] mx-auto">
      <div className="flex flex-col md:flex-row min-h-screen">
        {/* Sidebar */}
        <aside className="w-full md:w-72 md:fixed md:right-0 md:top-16 md:h-[calc(100vh-4rem)] bg-surface-container-lowest/85 glass-panel shadow-editorial flex flex-col p-5 gap-4 order-first md:order-last overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-1">{t('compare.filters')}</h3>
            <p className="text-xs text-on-surface-variant">{t('compare.filters.lead')}</p>
          </div>
          {[
            { icon: 'calendar_today', label: t('overview.f.year') },
            { icon: 'location_on', label: t('overview.f.location') },
            { icon: 'school', label: t('overview.f.programme') },
            { icon: 'history_edu', label: t('overview.f.studyMode') },
            { icon: 'group', label: t('query.f.cohort') },
          ].map((f, i) => (
            <button
              key={f.label}
              className={`w-full flex items-center gap-3 p-3 text-sm font-medium rounded-xl transition-colors text-left ${
                i === 0
                  ? 'bg-surface-container-low text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              <Icon name={f.icon} className="text-lg" />
              <span>{f.label}</span>
            </button>
          ))}

          {/* Data source indicator */}
          <div className="mt-auto bg-surface-container-low p-4 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-on-surface-variant uppercase">{t('compare.source.title')}</span>
              {loading ? (
                <span className="w-2 h-2 rounded-full bg-outline/50 animate-pulse" />
              ) : isLive ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-tertiary-container">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary-container animate-pulse" />
                  {t('compare.live')}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-outline/40" />
                  {t('compare.demo')}
                </span>
              )}
            </div>
            <p className="text-[10px] text-on-surface-variant leading-relaxed">
              {t('compare.source.body')}
            </p>
          </div>
        </aside>

        {/* Main content */}
        <section className="flex-1 p-5 md:p-12 bg-surface md:mr-72">
          {/* Header */}
          <div className="mb-8 md:mb-16">
            <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight font-headline text-primary mb-2">
              {t('compare.title')}
            </h1>
            <p className="text-on-surface-variant max-w-2xl font-body">
              {t('compare.lead')}
            </p>
          </div>

          {/* Comparison selector */}
          <div className="grid grid-cols-1 md:grid-cols-11 gap-3 md:gap-4 mb-8 md:mb-12 items-center">
            <div className="md:col-span-5 bg-surface-container-lowest p-5 rounded-xl shadow-editorial">
              <label className="text-[10px] uppercase font-bold text-secondary mb-2 block">
                {t('compare.selectionA')}
              </label>
              <select
                value={selA}
                onChange={(e) => setSelA(e.target.value)}
                className="w-full text-lg font-bold text-primary bg-transparent border-none outline-none cursor-pointer font-headline appearance-none"
              >
                {PROGRAMMES.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === selB}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-sm text-on-surface-variant mt-1">{progA?.year}</p>
            </div>

            <div className="md:col-span-1 flex justify-center">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white"
                style={{ background: 'linear-gradient(135deg, #002F59, #00467F)' }}
              >
                {t('compare.vs')}
              </div>
            </div>

            <div className="md:col-span-5 md:text-right bg-surface-container-lowest p-5 rounded-xl shadow-editorial">
              <label className="text-[10px] uppercase font-bold text-secondary mb-2 block">
                {t('compare.selectionB')}
              </label>
              <select
                value={selB}
                onChange={(e) => setSelB(e.target.value)}
                className="w-full text-lg font-bold text-secondary bg-transparent border-none outline-none cursor-pointer font-headline appearance-none text-right"
              >
                {PROGRAMMES.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === selA}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-sm text-on-surface-variant mt-1">{progB?.year}</p>
            </div>
          </div>

          {/* Mirrored mock chart */}
          <div className="bg-surface-container-low rounded-2xl p-4 md:p-10">
            <div className="flex justify-between items-center mb-8 border-b border-outline-variant/10 pb-5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  {t('compare.score')}
                </span>
              </div>
              <span className="text-sm font-headline font-bold text-primary">{t('compare.topNse')}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  {t('compare.score')}
                </span>
                <span className="w-3 h-3 rounded-full bg-secondary" />
              </div>
            </div>

            <div className="space-y-4">
              {sortedKeys.map((key) => (
                <MirroredRow
                  key={key}
                  label={t('compare.label.' + key)}
                  valueA={dataA[key]}
                  valueB={dataB[key]}
                />
              ))}
            </div>

            <div className="mt-8 flex justify-between text-[10px] font-medium text-on-surface-variant/50 uppercase tracking-widest border-t border-outline-variant/10 pt-4">
              <span>{t('compare.respondents', { n: progA?.respondents })}</span>
              <span>{t('compare.demoData')}</span>
              <span>{t('compare.respondents', { n: progB?.respondents })}</span>
            </div>
          </div>

          {/* Analysis cards */}
          <div className="mt-8 md:mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-editorial">
              <div className="flex items-center gap-3 mb-4">
                <Icon name="trending_up" className="text-tertiary-container" />
                <h3 className="font-headline font-bold text-lg text-primary">{t('compare.biggest.title')}</h3>
              </div>
              <p className="text-sm text-on-surface-variant leading-relaxed mb-4">
                {t('compare.biggest.body', {
                  label: t('compare.label.' + biggestDiffKey),
                  a: progA?.name,
                  scoreA: dataA[biggestDiffKey].toFixed(1),
                  b: progB?.name,
                  scoreB: dataB[biggestDiffKey].toFixed(1),
                })}
              </p>
              <div className="flex items-center gap-2 text-xs font-bold text-primary cursor-pointer hover:underline">
                <span>{t('compare.report')}</span>
                <Icon name="arrow_forward" className="text-xs" />
              </div>
            </div>

            <div
              className="p-8 rounded-2xl text-white shadow-ambient relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #002F59 0%, #00467F 100%)' }}
            >
              <div className="relative z-10">
                <h3 className="font-headline font-bold text-lg mb-3">{t('compare.action.title')}</h3>
                <p className="text-sm text-blue-100/80 leading-relaxed mb-5">
                  {t('compare.action.body')}
                </p>
                <button className="bg-white text-primary px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide hover:bg-surface-container-low transition-colors">
                  {t('compare.share')}
                </button>
              </div>
              <Icon name="lightbulb" className="absolute -bottom-4 -right-4 text-9xl text-white/5" style={{ fontSize: '9rem' }} />
            </div>
          </div>

          {/* ── Live pipeline section (below mock chart) ── */}
          {isLive && <LiveCompareSection compare={compare} />}

          <footer className="mt-16 text-center text-xs text-on-surface-variant opacity-40">
            {t('compare.footer')}
          </footer>
        </section>
      </div>
    </main>
  )
}
