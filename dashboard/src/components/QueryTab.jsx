import { useState, useEffect } from 'react';
import { apiUrl } from '../services/api';

export default function QueryTab() {
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

  // Fetch filter options on mount
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
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      setError('Please enter a search query');
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
        setError(data.error || 'Search failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">✨ Query Vector Database</h2>
        <p className="text-gray-600 mt-1">Ask natural language questions about your anonymized feedback</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="space-y-4">
        <div className="bg-gray-50 p-4 rounded-lg space-y-4 border border-gray-200">
          
          {/* Query Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Your Question</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., What do students say about the teaching quality?"
              disabled={loading}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:opacity-50"
              rows="3"
            />
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700">🔍 Filters (optional)</p>
            
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Institution */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Institution</label>
                <select
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">All</option>
                  {filterOptions.institutions.map(inst => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              </div>

              {/* Academic Year */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">All</option>
                  {filterOptions.academic_years.map(yr => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">All</option>
                  {filterOptions.locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              {/* Programme */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Programme</label>
                <select
                  value={programme}
                  onChange={(e) => setProgramme(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">All</option>
                  {filterOptions.programmes.map(prog => (
                    <option key={prog} value={prog}>{prog}</option>
                  ))}
                </select>
              </div>

              {/* Study Mode */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Study Mode</label>
                <select
                  value={studyMode}
                  onChange={(e) => setStudyMode(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">All</option>
                  {filterOptions.study_modes.map(mode => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </div>

              {/* Cohort */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Cohort</label>
                <select
                  value={cohort}
                  onChange={(e) => setCohort(e.target.value)}
                  disabled={loading || optionsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="all">All</option>
                  {filterOptions.cohorts.map(coh => (
                    <option key={coh} value={coh}>{coh}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || optionsLoading}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin">⏳</span>
                Searching...
              </>
            ) : (
              <>
                <span>🔍</span>
                Search Database
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <strong>❌ Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {searchPerformed && !loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-800">
              📊 Results for "{query}"
            </h3>
            <span className="text-sm text-gray-600">
              {results.length} found
            </span>
          </div>

          {results.length === 0 ? (
            <div className="p-6 text-center bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-gray-600">No results found. Try a different query or adjust filters.</p>
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
                          Match: {(result.similarity * 100).toFixed(1)}%
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