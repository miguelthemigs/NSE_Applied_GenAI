import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import ThemeCard from '../components/ThemeCard'
import FilterDropdown from '../components/FilterDropdown'
import HeroBanner from '../components/HeroBanner'
import SubthemeWordCloud from '../components/SubthemeWordCloud'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { getJson, OfflineError } from '../services/api'
import { useI18n } from '../i18n/I18nProvider'
import { LayoutGroup, motion } from 'framer-motion'
import { parseThemesOverview } from '../utils/overviewResponse'
import { LOCATION_OPTIONS } from '../constants/locations'
import { buildRealTheme } from '../constants/realThemes'
import {
  filtersFromSearchParams,
  filtersToApiParams,
  filtersToSearchParams,
  hasActiveFilters as filtersHaveActiveValues,
  normalizeFilters,
  stableFilterKey,
} from '../utils/filters'

// Every list the filter bar reads. A response that leaves one out (or sends
// `options: {}`) gets an empty list instead of crashing the page.
const EMPTY_FILTER_OPTIONS = {
  academic_years: [],
  locations: [],
  programmes: [],
  study_modes: [],
  cohorts: [],
  sectors: [],
  languages: [],
}

function withFilterDefaults(options) {
  const merged = { ...EMPTY_FILTER_OPTIONS }
  for (const [key, value] of Object.entries(options ?? {})) {
    merged[key] = Array.isArray(value) ? value : []
  }
  return merged
}

/** The centred card for an empty or unavailable Overview (mockup Overview). */
function StateCard({ icon, children }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl px-6 py-12 md:py-14 flex flex-col items-center text-center gap-3.5">
      <span className="w-16 h-16 rounded-2xl bg-primary-fixed text-primary flex items-center justify-center">
        <Icon name={icon} className="text-[32px]" />
      </span>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Overview() {
  const { t, formatDate } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])

  // Fetch filter options on mount
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);

  useEffect(() => {
    getJson('/api/filter-options')
      .then(({ data }) => {
        if (data?.status === 'success') setFilterOptions(withFilterDefaults(data.options));
      })
      .catch(e => console.error(e));
  }, []);

  // "Last updated" in the hero comes from the pipeline status (max completed_at).
  const [lastUpdated, setLastUpdated] = useState(null)
  useEffect(() => {
    getJson('/api/pipeline/status')
      .then(({ data }) => { if (data?.status === 'success') setLastUpdated(data.last_updated ?? null) })
      .catch(() => {})
  }, [])

  const [availableFilterOptions, setAvailableFilterOptions] = useState(null);
  useEffect(() => {
    const apiFilters = filtersToApiParams(filters);
    if (Object.keys(apiFilters).length === 0) {
      setAvailableFilterOptions(null);
      return;
    }
    const params = new URLSearchParams(apiFilters);
    getJson(`/api/filter-options?${params}`)
      .then(({ data }) => { if (data?.status === 'success') setAvailableFilterOptions(withFilterDefaults(data.options)); })
      .catch(() => {});
  }, [filters]);

  const [dynamicThemesData, setDynamicThemesData] = useState({})
  const [overviewMeta, setOverviewMeta] = useState(null)
  const [overviewKind, setOverviewKind] = useState('ok')
  const [overviewDetail, setOverviewDetail] = useState(null)
  const [loadingThemes, setLoadingThemes] = useState(true)
  
  // Fetch dynamic theme data using the same canonical filter mapping as detail pages.
  useEffect(() => {
    const params = new URLSearchParams(filtersToApiParams(filters))

    setLoadingThemes(true)
    getJson(`/api/themes-overview?${params}`)
      .then(({ ok, data }) => ({ ok, data }))
      .catch(e => {
        console.error(e)
        if (e instanceof OfflineError) return { offline: true }
        throw e
      })
      .then(result => {
        const parsed = parseThemesOverview(result)
        setOverviewKind(parsed.kind)
        setOverviewDetail(parsed.kind === 'error' ? (result?.data?.error ?? result?.data?.message ?? null) : null)
        setDynamicThemesData(parsed.themes)
        setOverviewMeta(
          parsed.kind === 'ok'
            ? { status: result.data.status ?? null, totalFilteredDocuments: result.data.total_filtered_documents ?? null }
            : null,
        )
      })
      .finally(() => setLoadingThemes(false))
  }, [filters])

  const apiFilters = useMemo(() => filtersToApiParams(filters), [filters])
  const apiFilterKey = useMemo(() => stableFilterKey(apiFilters), [apiFilters])

  const themes = useMemo(() => {
    return Object.entries(dynamicThemesData)
      .filter(([themeName]) => themeName !== 'No Meaningful Response')
      .map(([themeName, insight]) => {
        const insightFilterKey = stableFilterKey(insight?.filters_applied ?? {})
        const includeInsightDetails = apiFilterKey === '{}' || insightFilterKey === apiFilterKey
        return buildRealTheme(themeName, insight, { includeInsightDetails })
      })
  }, [dynamicThemesData, apiFilterKey])

  const hasFilteredSubthemeData = useMemo(() => {
    return themes.some((theme) => {
      const mentions = theme.subtheme_mentions || theme.cachedInsight?.subtheme_mentions || []
      return mentions.some((mention) => (mention.mentions || 0) > 0)
    })
  }, [themes])

  const hasFilteredThemeData = useMemo(() => {
    return themes.some((theme) => {
      const count = theme.responseCount ?? theme.percentage ?? 0
      return count > 0
    })
  }, [themes])

  const hasThemePayload = themes.length > 0

  // Sort themes by percentage (which is the actual count of comments)
  const sortedThemes = useMemo(() => {
    return [...themes].sort((a, b) => b.percentage - a.percentage)
  }, [themes])



  function setFilter(key, value) {
    const nextFilters = normalizeFilters({ ...filters, [key]: value })
    setSearchParams(filtersToSearchParams(nextFilters))
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams())
  }

  const hasActiveFilters = filtersHaveActiveValues(filters)
  const hasNoMatchingResponses = hasActiveFilters && overviewMeta?.totalFilteredDocuments === 0
  const showNoSubthemeData = !hasNoMatchingResponses && hasActiveFilters && !hasFilteredSubthemeData
  const displayThemes = hasNoMatchingResponses ? [] : themes
  // Nothing to show or filter yet (mockup Overview): plain disabled selects, no theme
  // heading and no sub-theme card under the state card.
  const noThemes = !loadingThemes && ['no_summaries', 'not_ready', 'offline', 'error'].includes(overviewKind)
  const filtersOff = !loadingThemes && ['no_summaries', 'not_ready', 'offline'].includes(overviewKind)
  const filterVariant = { variant: filtersOff ? 'select' : 'dropdown', disabled: filtersOff }

  return (
    <main className="max-w-[1040px] mx-auto px-4 sm:px-6 pt-8 pb-16 flex flex-col gap-5">

      {/* ── Hero Stats Banner (or a plain header while there is nothing to count) ── */}
      {overviewKind === 'ok' ? (
        <HeroBanner themes={displayThemes} lastUpdated={lastUpdated} />
      ) : (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5 max-w-[640px]">
            <span className="text-xs font-bold tracking-[0.08em] uppercase text-on-surface-variant">{t('overview.eyebrow')}</span>
            <h1 className="m-0 font-headline font-extrabold text-[26px] sm:text-[32px] leading-tight tracking-tight text-primary">{t('overview.title')}</h1>
            <p className="m-0 text-on-surface-variant">{t('overview.leadPlain')}</p>
          </div>
          {formatDate(lastUpdated) && <p className="m-0 text-[13px] text-on-surface-variant">{t('done.updated', { date: formatDate(lastUpdated) })}</p>}
        </header>
      )}

      {/* ── Filters bar ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="relative z-20 bg-surface-container-lowest border border-outline-variant rounded-2xl px-5 py-4"
      >
        <div className="flex flex-wrap md:flex-nowrap gap-3 flex-1">
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="calendar_today"
              label={t('overview.f.year')}
              value={filters.jaar}
              options={['All', ...filterOptions.academic_years]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.academic_years] : null}
              {...filterVariant}
              onChange={(v) => setFilter('jaar', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="location_on"
              label={t('overview.f.location')}
              value={filters.locatie}
              options={LOCATION_OPTIONS}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.locations] : null}
              {...filterVariant}
              onChange={(v) => setFilter('locatie', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="school"
              label={t('overview.f.programme')}
              value={filters.opleiding}
              options={['All', ...filterOptions.programmes]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.programmes] : null}
              {...filterVariant}
              onChange={(v) => setFilter('opleiding', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="history_edu"
              label={t('overview.f.studyMode')}
              value={filters.studievorm}
              options={['All', ...filterOptions.study_modes]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.study_modes] : null}
              {...filterVariant}
              onChange={(v) => setFilter('studievorm', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="translate"
              label={t('overview.f.language')}
              value={filters.taal}
              options={['All', ...filterOptions.languages]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.languages] : null}
              {...filterVariant}
              onChange={(v) => setFilter('taal', v)}
            />
          </div>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name="filter_alt_off" className="text-sm" />
            {t('overview.clearFilters')}
          </button>
        )}
      </motion.div>
      <div className="flex flex-col gap-6 md:gap-8 w-full">

        {/* Theme Landscape */}
        <section>
          {!noThemes && (
            <div className="flex items-end justify-between mb-5">
              <h2 className="text-2xl font-bold font-headline text-primary">
                {t('overview.themesTitle')}
              </h2>
            </div>
          )}

          {loadingThemes ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 text-center shadow-ambient border border-outline-variant/10">
              <Icon name="hourglass_empty" className="text-4xl text-outline mb-3 block animate-pulse" />
              <h3 className="text-lg font-bold font-headline text-primary">
                {t('overview.loading')}
              </h3>
            </div>
          ) : overviewKind === 'no_summaries' ? (
            <StateCard icon="description">
              <h3 className="m-0 font-headline font-extrabold text-2xl text-primary">
                {t('overview.empty')}
              </h3>
              <p className="m-0 text-on-surface-variant max-w-[520px]">
                {t('overview.emptyBody')}
              </p>
              <Link
                to="/pipeline-demo?step=insights"
                className="mt-1.5 inline-flex items-center gap-2.5 min-h-[48px] rounded-xl bg-primary px-5 py-3 text-[15px] font-semibold text-on-primary no-underline hover:bg-primary-container transition-colors duration-150"
              >
                {t('overview.emptyAction')}
                <Icon name="arrow_forward" className="text-[18px]" />
              </Link>
            </StateCard>
          ) : overviewKind === 'not_ready' || overviewKind === 'offline' || overviewKind === 'error' ? (
            <StateCard icon={overviewKind === 'not_ready' ? 'hourglass_empty' : overviewKind === 'error' ? 'error' : 'cloud_off'}>
              <p className="m-0 font-semibold text-on-surface max-w-[520px]" role="status">
                {overviewKind === 'not_ready'
                  ? t('overview.notReady')
                  : overviewKind === 'error'
                    ? t('overview.error')
                    : t('overview.offline')}
              </p>
              {overviewKind === 'error' && overviewDetail && (
                <details className="text-xs text-on-surface-variant">
                  <summary className="cursor-pointer">{t('action.details')}</summary>
                  <p className="mt-1 break-words">{String(overviewDetail)}</p>
                </details>
              )}
            </StateCard>
          ) : hasNoMatchingResponses ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 text-center shadow-ambient border border-outline-variant/10">
              <Icon name="filter_alt_off" className="text-4xl text-outline mb-3 block" />
              <h3 className="text-lg font-bold font-headline text-primary">
                {t('overview.noMatch.title')}
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                {t('overview.noMatch.body')}
              </p>
              <button
                onClick={clearFilters}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 transition-colors"
              >
                <Icon name="refresh" className="text-base" />
                {t('overview.noMatch.action')}
              </button>
            </div>
          ) : !hasThemePayload || !hasFilteredThemeData ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 text-center shadow-ambient border border-outline-variant/10">
              <Icon name="database_off" className="text-4xl text-outline mb-3 block" />
              <h3 className="text-lg font-bold font-headline text-primary">
                {t('overview.empty')}
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                {t('overview.emptyAction')}
              </p>
            </div>
          ) : (
            <LayoutGroup>
              <div className="flex flex-col gap-6">
                {/* Top 3 themes (Large cards side-by-side) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {sortedThemes.slice(0, 3).map((theme, idx) => (
                    <ThemeCard
                      key={theme.id}
                      theme={theme}
                      size="large"
                      filters={filters}
                      index={idx}
                    />
                  ))}
                </div>

                {/* Remaining themes (Small cards below) */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {sortedThemes.slice(3).map((theme, idx) => (
                    <ThemeCard
                      key={theme.id}
                      theme={theme}
                      size="small"
                      filters={filters}
                      index={idx + 3}
                    />
                  ))}
                </div>
              </div>
            </LayoutGroup>
          )}
        </section>

        {/* Sub-theme Word Cloud */}
        {!noThemes && (
          <SubthemeWordCloud
            themes={displayThemes}
            empty={hasNoMatchingResponses}
            missingFilteredData={showNoSubthemeData}
          />
        )}
      </div>


    </main>
  )
}
