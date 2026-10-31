import { useState, useEffect } from 'react';
import { apiUrl } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';
import GateReason from './pipeline/GateReason';
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('step.query')}</h2>
        <p className="text-gray-600 mt-1">{t('step.query.lead')}</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="space-y-4">
        <div className="bg-gray-50 p-4 rounded-lg space-y-4 border border-gray-200">
          
          {/* Query Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">{t('query.question')}</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('query.placeholder')}
              disabled={loading}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:opacity-50"
              rows="3"
            />
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700">{t('query.filters')}</p>
            
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Institution */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('query.f.institution')}</label>
                <select
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">{t('common.all')}</option>
                  {filterOptions.institutions.map(inst => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              </div>

              {/* Academic Year */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('query.f.year')}</label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">{t('common.all')}</option>
                  {filterOptions.academic_years.map(yr => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('query.f.location')}</label>
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">{t('common.all')}</option>
                  {filterOptions.locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              {/* Programme */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('query.f.programme')}</label>
                <select
                  value={programme}
                  onChange={(e) => setProgramme(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">{t('common.all')}</option>
                  {filterOptions.programmes.map(prog => (
                    <option key={prog} value={prog}>{prog}</option>
                  ))}
                </select>
              </div>

              {/* Study Mode */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('query.f.studyMode')}</label>
                <select
                  value={studyMode}
                  onChange={(e) => setStudyMode(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">{t('common.all')}</option>
                  {filterOptions.study_modes.map(mode => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </div>

              {/* Cohort */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('query.f.cohort')}</label>
                <select
                  value={cohort}
                  onChange={(e) => setCohort(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">{t('common.all')}</option>
                  {filterOptions.cohorts.map(coh => (
                    <option key={coh} value={coh}>{coh}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <GateReason stepId="query" showBusy={false} onNavigate={onNavigate} className="block" />

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || optionsLoading || blocked}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Icon name="progress_activity" className="animate-spin" />
                {t('query.searching')}
              </>
            ) : (
              <>
                <Icon name="search" />
                {t('query.search')}
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <strong>{t(error.kind === 'empty' ? 'query.err.empty' : 'query.err.title')}</strong>
          {error.detail && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">{t('action.details')}</summary>
              <p className="mt-1 break-words">{error.detail}</p>
            </details>
          )}
        </div>
      )}

      {/* Results */}
      {searchPerformed && !loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-800">
              {t('query.results', { n: formatNumber(results.length), q: query })}
            </h3>
          </div>

          {results.length === 0 ? (
            <div className="p-6 text-center bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-gray-600">{t('query.none')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-blue-50 border border-blue-200 rounded-lg hover:shadow-md transition"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-bold text-blue-700">#{idx + 1}</span>
                    <div className="flex gap-2 text-xs flex-wrap justify-end">
                      {result.similarity !== undefined && (
                        <span className="px-2 py-1 bg-green-200 text-green-800 rounded">
                          {t('query.match', { x: Math.round(result.similarity * 100) })}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-gray-700 leading-relaxed">{result.document}</p>
                  {result.metadata && Object.keys(result.metadata).length > 0 && (
                    <div className="mt-3 text-xs text-gray-600 space-y-1">
                      {Object.entries(result.metadata).map(([key, val]) => (
                        <div key={key}>
                          <strong>{key}:</strong> {val}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}