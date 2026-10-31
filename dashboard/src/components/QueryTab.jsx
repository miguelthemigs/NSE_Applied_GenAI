import { useState, useEffect } from 'react';
import { apiUrl } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';
import GateReason from './pipeline/GateReason';
import StepHeader from './pipeline/StepHeader';
import { errorBox, fieldLabel, primaryButton, stepBody, textInput } from './pipeline/stepStyles';
import { usePipelineStatus } from '../context/PipelineStatusContext';
import { deriveStepView } from '../utils/stepView';

export default function QueryTab({ onNavigate }) {
  const { t, formatNumber } = useI18n();
  const { status } = usePipelineStatus();
  // Searching starts no job, so only the missing vector DB blocks it.
  const view = deriveStepView(status, 'query');
  const blocked = !status || Boolean(view.blockedBy);
  const vectorsAt = status?.steps?.vectors?.completed_at;
  const [query, setQuery] = useState('');
  const [institution, setInstitution] = useState('all');
  const [year, setYear] = useState('all');
  const [location, setLocation] = useState('all');
  const [programme, setProgramme] = useState('all');
  const [studyMode, setStudyMode] = useState('all');
  const [cohort, setCohort] = useState('all');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchPerformed, setSearchPerformed] = useState(false);
  
  // Filter options state
  const [filterOptions, setFilterOptions] = useState({
    institutions: [],
    academic_years: [],
    locations: [],
    programmes: [],
    study_modes: [],
    cohorts: []
  });
  const [optionsLoading, setOptionsLoading] = useState(true);

  // Fetch filter options on mount, and again after a new vector DB was built
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const response = await fetch(apiUrl('/api/filter-options'));
        const data = await response.json();
        
        if (data.status === 'success') {
          setFilterOptions(data.options);
        }
      } catch (err) {
        console.error('Error fetching filter options:', err);
      } finally {
        setOptionsLoading(false);
      }
    };
    
    fetchFilterOptions();
  }, [vectorsAt]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      setError({ kind: 'empty' });
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const params = new URLSearchParams({
        query: query.trim(),
        n: '10'
      });

      // Add filters only if not 'all'
      if (institution !== 'all') params.append('institution', institution);
      if (year !== 'all') params.append('academic_year', year);
      if (location !== 'all') params.append('location', location);
      if (programme !== 'all') params.append('programme', programme);
      if (studyMode !== 'all') params.append('study_mode', studyMode);
      if (cohort !== 'all') params.append('cohort', cohort);

      const response = await fetch(apiUrl(`/api/query-vectors?${params}`), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (data.status === 'success') {
        setResults(data.results || []);
        setSearchPerformed(true);
      } else {
        setError({ kind: 'failed', detail: data.error });
      }
    } catch (err) {
      setError({ kind: 'failed', detail: err.message });
    } finally {
      setLoading(false);
    }
  };

  const FILTERS = [
    { key: 'institution', label: 'query.f.institution', value: institution, set: setInstitution, options: filterOptions.institutions },
    { key: 'year', label: 'query.f.year', value: year, set: setYear, options: filterOptions.academic_years },
    { key: 'location', label: 'query.f.location', value: location, set: setLocation, options: filterOptions.locations },
    { key: 'programme', label: 'query.f.programme', value: programme, set: setProgramme, options: filterOptions.programmes },
    { key: 'studyMode', label: 'query.f.studyMode', value: studyMode, set: setStudyMode, options: filterOptions.study_modes },
    { key: 'cohort', label: 'query.f.cohort', value: cohort, set: setCohort, options: filterOptions.cohorts },
  ];

  return (
    <>
      <StepHeader stepId="query" />
      <div className={stepBody}>
        <form onSubmit={handleSearch} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{t('query.question')}</span>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('query.placeholder')}
              disabled={loading}
              className={`${textInput} py-3 resize-none`}
              rows="3"
            />
          </label>

          <fieldset className="m-0 p-0 border-0 flex flex-col gap-3 min-w-0">
            <legend className={`${fieldLabel} p-0 mb-3`}>{t('query.filters')}</legend>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 gap-3">
              {FILTERS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 min-w-0">
                  <span className="text-[13px] font-semibold text-on-surface-variant">{t(f.label)}</span>
                  <select
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    disabled={loading || optionsLoading}
                    className={textInput}
                  >
                    <option value="all">{t('common.all')}</option>
                    {(f.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              disabled={loading || optionsLoading || blocked}
              className={`${primaryButton} max-sm:w-full min-h-[48px] text-[15px]`}
            >
              {loading ? (
                <>
                  <Icon name="progress_activity" className="text-[20px] motion-safe:animate-spin" />
                  {t('query.searching')}
                </>
              ) : (
                <>
                  <Icon name="search" className="text-[20px]" />
                  {t('query.search')}
                </>
              )}
            </button>
            <GateReason stepId="query" showBusy={false} onNavigate={onNavigate} />
          </div>
        </form>

        {error && (
          <div role="alert" className={errorBox}>
            <Icon name="error" className="text-[22px] shrink-0" />
            <div className="min-w-0">
              <p className="m-0 font-bold">{t(error.kind === 'empty' ? 'query.err.empty' : 'query.err.title')}</p>
              {error.detail && (
                <details className="mt-1 text-sm">
                  <summary className="cursor-pointer">{t('action.details')}</summary>
                  <p className="mt-1 break-words">{error.detail}</p>
                </details>
              )}
            </div>
          </div>
        )}

        {searchPerformed && !loading && (
          <section className="flex flex-col gap-3 min-w-0">
            <h3 className="m-0 text-base font-bold text-on-surface break-words">
              {t('query.results', { n: formatNumber(results.length), q: query })}
            </h3>

            {results.length === 0 ? (
              <p className="m-0 rounded-[12px] bg-surface-container-low p-6 text-center text-on-surface-variant">{t('query.none')}</p>
            ) : (
              <ol className="m-0 p-0 list-none flex flex-col gap-3">
                {results.map((result, idx) => (
                  <li key={idx} className="border border-outline-variant rounded-[12px] p-4 flex flex-col gap-2 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-headline font-extrabold text-primary">#{idx + 1}</span>
                      {result.similarity !== undefined && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary-fixed text-primary">
                          {t('query.match', { x: Math.round(result.similarity * 100) })}
                        </span>
                      )}
                    </div>
                    <p className="m-0 text-on-surface leading-relaxed break-words">{result.document}</p>
                    {result.metadata && Object.keys(result.metadata).length > 0 && (
                      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                        {Object.entries(result.metadata).map(([key, val]) => (
                          <div key={key} className="contents">
                            <dt className="font-semibold">{key}</dt>
                            <dd className="m-0 break-words">{String(val)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </>
  );
}
