import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import ThemeCard from '../components/ThemeCard'
import FilterDropdown from '../components/FilterDropdown'
import HeroBanner from '../components/HeroBanner'
import SubthemeWordCloud from '../components/SubthemeWordCloud'
import { Link } from 'react-router-dom'
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

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Overview() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])

  // Fetch filter options on mount
  const [filterOptions, setFilterOptions] = useState({
    academic_years: [],
    locations: [],
    programmes: [],
    study_modes: [],
    cohorts: [],
    sectors: [],
    languages: [],
  });

  useEffect(() => {
    fetch('http://localhost:5001/api/filter-options')
      .then(r => r.json())
      .then(data => {
        if (data.status === 'success') setFilterOptions(data.options);
      })
      .catch(e => console.error(e));
  }, []);

  const [availableFilterOptions, setAvailableFilterOptions] = useState(null);
  useEffect(() => {
    const apiFilters = filtersToApiParams(filters);
    if (Object.keys(apiFilters).length === 0) {
      setAvailableFilterOptions(null);
      return;
    }
    const params = new URLSearchParams(apiFilters);
    fetch(`http://localhost:5001/api/filter-options?${params}`)
      .then(r => r.json())
      .then(data => { if (data.status === 'success') setAvailableFilterOptions(data.options); })
      .catch(() => {});
  }, [filters]);

  const [dynamicThemesData, setDynamicThemesData] = useState({})
  const [overviewMeta, setOverviewMeta] = useState(null)
  const [overviewKind, setOverviewKind] = useState('ok')
  const [loadingThemes, setLoadingThemes] = useState(true)
  
  // Fetch dynamic theme data using the same canonical filter mapping as detail pages.
  useEffect(() => {
    const params = new URLSearchParams(filtersToApiParams(filters))

    setLoadingThemes(true)
    fetch(`http://localhost:5001/api/themes-overview?${params}`)
      .then(async r => {
        const data = await r.json().catch(() => null)
        return { ok: r.ok, data }
      })
      .catch(e => {
        console.error(e)
        return { offline: true }
      })
      .then(result => {
        const parsed = parseThemesOverview(result)
        setOverviewKind(parsed.kind)
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

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6 md:px-8 md:py-8 flex flex-col gap-6">

      {/* ── Hero Stats Banner ── */}
      {overviewKind === 'ok' && <HeroBanner themes={displayThemes} />}

      {/* ── Filters bar ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="relative z-20 bg-surface-container-lowest/85 glass-panel shadow-editorial rounded-2xl px-5 py-4"
      >
        <div className="flex flex-wrap md:flex-nowrap gap-3 flex-1">
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="calendar_today"
              label="Academic Year"
              value={filters.jaar}
              options={['All', ...filterOptions.academic_years]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.academic_years] : null}
              onChange={(v) => setFilter('jaar', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="location_on"
              label="Location"
              value={filters.locatie}
              options={LOCATION_OPTIONS}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.locations] : null}
              onChange={(v) => setFilter('locatie', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="school"
              label="Programme"
              value={filters.opleiding}
              options={['All', ...filterOptions.programmes]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.programmes] : null}
              onChange={(v) => setFilter('opleiding', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="history_edu"
              label="Study Mode"
              value={filters.studievorm}
              options={['All', ...filterOptions.study_modes]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.study_modes] : null}
              onChange={(v) => setFilter('studievorm', v)}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <FilterDropdown
              icon="translate"
              label="Language"
              value={filters.taal}
              options={['All', ...filterOptions.languages]}
              availableOptions={availableFilterOptions ? ['All', ...availableFilterOptions.languages] : null}
              onChange={(v) => setFilter('taal', v)}
            />
          </div>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-sm">filter_alt_off</span>
            Clear all filters
          </button>
        )}
      </motion.div>
      <div className="flex flex-col gap-6 md:gap-8 w-full">

        {/* Theme Landscape */}
        <section>
          <div className="flex items-end justify-between mb-5">
            <div>
              <h2 className="text-2xl font-bold font-headline text-primary">
                Theme Frequency Insights
              </h2>
            </div>
          </div>

          {loadingThemes ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 text-center shadow-ambient border border-outline-variant/10">
              <span className="material-symbols-outlined text-4xl text-outline mb-3 block animate-pulse">
                hourglass_empty
              </span>
              <h3 className="text-lg font-bold font-headline text-primary">
                Loading real theme data
              </h3>
            </div>
          ) : overviewKind === 'no_summaries' ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 md:p-14 text-center shadow-ambient border border-outline-variant/10 flex flex-col items-center gap-3">
              <span className="material-symbols-outlined text-4xl text-primary mb-1 block">description</span>
              <h3 className="text-2xl font-bold font-headline text-primary">
                {/* TODO(i18n): t('overview.empty') */}
                Er zijn nog geen samenvattingen
              </h3>
              <p className="text-sm text-on-surface-variant max-w-[520px]">
                {/* TODO(i18n): t('overview.emptyBody') */}
                De antwoorden zijn verwerkt, maar de AI heeft nog geen samenvattingen geschreven. Zodra stap 4 klaar is, zie je hier de thema's met hun aantallen.
              </p>
              <Link
                to="/pipeline-demo?step=insights"
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                {/* TODO(i18n): t('overview.emptyAction') */}
                Ga naar stap 4: Samenvattingen schrijven
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </Link>
            </div>
          ) : overviewKind === 'not_ready' || overviewKind === 'offline' || overviewKind === 'error' ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 text-center shadow-ambient border border-outline-variant/10">
              <span className="material-symbols-outlined text-4xl text-outline mb-3 block">
                {overviewKind === 'not_ready' ? 'hourglass_empty' : 'cloud_off'}
              </span>
              <p className="text-sm text-on-surface-variant" role="status">
                {overviewKind === 'not_ready' && (
                  /* TODO(i18n): t('overview.notReady') */
                  'De gegevens worden nog voorbereid. Rond stap 2 af en probeer het opnieuw.'
                )}
                {overviewKind !== 'not_ready' && (
                  /* TODO(i18n): t('overview.offline') */
                  'De analyse-service is niet bereikbaar. Start de app opnieuw.'
                )}
              </p>
            </div>
          ) : hasNoMatchingResponses ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 text-center shadow-ambient border border-outline-variant/10">
              <span className="material-symbols-outlined text-4xl text-outline mb-3 block">
                filter_alt_off
              </span>
              <h3 className="text-lg font-bold font-headline text-primary">
                No responses match this filter combination
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                Try removing one filter or clear everything to return to the full dashboard.
              </p>
              <button
                onClick={clearFilters}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 transition-colors"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                Clear filters
              </button>
            </div>
          ) : !hasThemePayload || !hasFilteredThemeData ? (
            <div className="bg-surface-container-lowest rounded-2xl p-8 text-center shadow-ambient border border-outline-variant/10">
              <span className="material-symbols-outlined text-4xl text-outline mb-3 block">
                database_off
              </span>
              <h3 className="text-lg font-bold font-headline text-primary">
                No real theme insights available
              </h3>
              <p className="text-sm text-on-surface-variant mt-2">
                Run insight generation for this filter set to populate the dashboard.
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
        <SubthemeWordCloud
          themes={displayThemes}
          empty={hasNoMatchingResponses}
          missingFilteredData={showNoSubthemeData}
        />
      </div>


    </main>
  )
}
