import { useState, useEffect, useRef } from 'react';
import { AVAILABLE_LLM_MODELS, LLM_PROVIDER } from '../config/llmModels.js';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';
import GateReason from './pipeline/GateReason';
import ProgressPanel from './pipeline/ProgressPanel';
import DoneCard from './pipeline/DoneCard';
import { usePipelineStatus } from '../context/PipelineStatusContext';
import { deriveStepView } from '../utils/stepView';
import { DONE_CARD_STATES } from '../utils/doneMessage';

const PILL = {
  done: 'bg-success-container text-success',
  partial: 'bg-primary-fixed text-primary',
  not_started: 'bg-surface-container-low text-on-surface-variant',
  off: 'bg-surface-container-lowest text-outline border border-dashed border-outline-variant',
};

// Placeholder for the step 4 results list (main themes, sub-themes, per
// year/location/programme) until the full ResultsList replaces it.
function ResultsPlaceholder({ summary }) {
  const { t, formatNumber } = useI18n();
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const done = num(summary?.themes_done);
  const total = num(summary?.themes_total);
  const sub = num(summary?.subthemes_done);
  const fDone = num(summary?.filtered_done);
  const fTotal = num(summary?.filtered_total);
  const progressState = (x, y) => (y > 0 && x >= y ? 'done' : x > 0 ? 'partial' : 'not_started');
  const rows = [
    { key: 'main', count: `${formatNumber(done)} / ${formatNumber(total)}`, state: progressState(done, total), vars: { x: done, y: total } },
    { key: 'sub', count: formatNumber(sub), state: sub > 0 ? 'done' : 'not_started' },
    {
      key: 'filtered',
      count: fTotal > 0 ? `${formatNumber(fDone)} / ${formatNumber(fTotal)}` : '—',
      state: fTotal > 0 ? progressState(fDone, fTotal) : 'off',
      vars: { x: fDone, y: fTotal },
    },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="m-0 text-base font-bold text-on-surface">{t('insights.results')}</h3>
      <ul className="m-0 p-0 list-none border border-outline-variant rounded-xl overflow-hidden">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-surface-container-highest last:border-b-0">
            <span className="flex-[1_1_220px] font-semibold text-on-surface">{t('insights.row.' + row.key)}</span>
            <span className="min-w-[60px] tabular-nums text-on-surface-variant">{row.count}</span>
            <span className={`text-[13px] font-semibold px-3 py-1 rounded-full ${PILL[row.state]}`}>{t('state.' + row.state, row.vars)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CacheBadge({ cached, total }) {
  const { t } = useI18n();
  if (cached === 0 && !total) return null;
  const full = total !== undefined && cached >= total;
  const partial = total !== undefined && cached > 0 && cached < total;
  const none = cached === 0;

  const dot = full ? 'bg-emerald-400' : partial ? 'bg-amber-400' : 'bg-white/30';
  const label = total !== undefined ? `${cached}/${total}` : cached > 0 ? t('ins.progress.cached', { n: cached }) : null;
  if (!label) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${none ? 'bg-white/10 text-white/50' : 'bg-white/20 text-white'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`}></span>
      {label}
    </span>
  );
}

export default function InsightGenerator({ onNavigate }) {
  const { t } = useI18n();
  const stream = useNdjsonStream();
  const { status, refresh } = usePipelineStatus();
  const view = deriveStepView(status, 'insights');
  const vectorsAt = status?.steps?.vectors?.completed_at;
  const insights = status?.steps?.insights;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [currentStage, setCurrentStage] = useState('');
  const [generating, setGenerating] = useState(false);
  // True while the user sets up a new run (or reads why it stopped) instead of the Done card.
  const [rerunning, setRerunning] = useState(false);

  // Configuration
  const [selectedModel, setSelectedModel] = useState('unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL');
  const [clearCache, setClearCache] = useState(false);
  const [allowModelDownload, setAllowModelDownload] = useState(true);
  const [maxDocuments, setMaxDocuments] = useState(240);
  const [totalDocs, setTotalDocs] = useState(null);
  const [filterDimensions, setFilterDimensions] = useState([]);
  const [dimensionSizes, setDimensionSizes] = useState({
    academic_year: 0,
    location: 0,
    programme: 0,
    study_mode: 0,
    language: 0,
  });
  const [validCombos, setValidCombos] = useState(null);

  // Seconds-per-insight rough estimate used for the time preview.
  // Empirical: measured 50–101s per call on RTX 4050 Laptop GPU, avg ~75s; using 90s to be conservative.
  const SECONDS_PER_INSIGHT = 90;
  const THEME_COUNT = 7;
  const [modelActivation, setModelActivation] = useState({
    status: 'idle',
    modelId: null,
    message: ''
  });

  const [cacheStatus, setCacheStatus] = useState({
    main_baseline: 0,
    main_filtered: 0,
    subtheme_baseline: 0,
    subtheme_filtered: 0,
  });

  const refreshCacheStatus = async () => {
    try {
      const res = await fetch(apiUrl('/api/cache-status'));
      const data = await res.json();
      if (data && typeof data.main_baseline === 'number') setCacheStatus(data);
    } catch {}
  };

  useEffect(() => { refreshCacheStatus(); }, []);

  const activationRequestRef = useRef(0);

  useEffect(() => {
    fetch(apiUrl('/api/vector-stats'))
      .then(r => r.json())
      .then(data => { if (data.total_documents > 0) setTotalDocs(data.total_documents) })
      .catch(() => {})
  }, [vectorsAt]);

  useEffect(() => {
    fetch(apiUrl('/api/filter-options'))
      .then(r => r.json())
      .then(data => {
        const opts = data?.options || {};
        setDimensionSizes({
          academic_year: (opts.academic_years || []).length,
          location: (opts.locations || []).length,
          programme: (opts.programmes || []).length,
          study_mode: (opts.study_modes || []).length,
          language: (opts.languages || []).length,
        });
      })
      .catch(() => {});
  }, [vectorsAt]);

  const toggleDimension = (key) => {
    setFilterDimensions(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  // Fetch valid combo count from backend whenever dimensions change.
  useEffect(() => {
    if (filterDimensions.length === 0) {
      setValidCombos(null);
      return;
    }
    fetch(apiUrl('/api/precompute-preview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter_dimensions: filterDimensions }),
    })
      .then(r => r.json())
      .then(data => { if (typeof data.valid_combos === 'number') setValidCombos(data.valid_combos); })
      .catch(() => {});
  }, [filterDimensions]);

  const extraCombos = filterDimensions.reduce(
    (acc, key) => acc * Math.max(dimensionSizes[key] || 0, 1),
    filterDimensions.length > 0 ? 1 : 0
  );
  const displayCombos = validCombos ?? extraCombos;
  const extraThemeInsights = displayCombos * THEME_COUNT;
  const estimatedMinutes = Math.round((extraThemeInsights * SECONDS_PER_INSIGHT) / 60);

  const selectAndStartModel = async (model) => {
    setSelectedModel(model.id);
    const requestId = activationRequestRef.current + 1;
    activationRequestRef.current = requestId;

    if (!allowModelDownload) {
      setModelActivation({
        status: 'idle',
        modelId: model.id,
        message: t('ins.model.selected')
      });
      return;
    }

    setModelActivation({
      status: 'starting',
      modelId: model.id,
      message: t('ins.model.starting')
    });

    try {
      const res = await fetch(apiUrl('/api/llm-models/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm_model: model.id,
          provider: LLM_PROVIDER
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'ready') {
        throw new Error(data.error || `Request failed with HTTP ${res.status}`);
      }
      if (activationRequestRef.current !== requestId) return;
      setModelActivation({
        status: 'ready',
        modelId: model.id,
        message: t('ins.model.ready')
      });
    } catch (e) {
      if (activationRequestRef.current !== requestId) return;
      setModelActivation({
        status: 'error',
        modelId: model.id,
        message: t('ins.model.error')
      });
    }
  };

  const launchPrecompute = async ({ endpoint, useFilterGrid, label }) => {
    setGenerating(true);
    setRerunning(true);
    setCurrentStage('');
    setLogs([{ kind: 'info', text: t('ins.log.start', { label: t(label), model: activeModel?.name || selectedModel }) }]);
    setProgress(0);

    const MAX_RETRIES = 30;
    const RETRY_DELAY_MS = 5000;

    if (clearCache) {
      const clearEndpoint = endpoint === '/api/precompute-subthemes'
        ? '/api/clear-subtheme-cache'
        : '/api/clear-cache';
      setLogs(prev => [...prev, { kind: 'info', text: t('ins.log.clearing') }]);
      try {
        await fetch(apiUrl(clearEndpoint), { method: 'POST' });
        setLogs(prev => [...prev, { kind: 'ok', text: t('ins.log.cleared') }]);
      } catch (e) {
        setLogs(prev => [...prev, { kind: 'warn', text: t('ins.log.clearFailed', { reason: e.message }) }]);
      }
    }

    const { THEMES } = await import('../data/themes.js');
    const body = {
      themes: THEMES,
      llm_model: selectedModel,
      provider: LLM_PROVIDER,
      allow_model_download: allowModelDownload,
      max_documents: maxDocuments,
      filter_dimensions: useFilterGrid ? filterDimensions : [],
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let completed = false;
      let sawEvent = false;

      const handleStreamEvent = (data) => {
        if (!sawEvent) {
          sawEvent = true;
          refresh();
        }
        if (data.status === 'progress') {
          setProgress(data.progress);
          if (data.stage) setCurrentStage(data.stage);
          const prefix = data.theme ? `[${data.theme}] ` : '';
          if (data.message) setLogs(prev => [...prev, { kind: 'info', text: `${prefix}${data.message}` }]);
        } else if (data.status === 'success') {
          completed = true;
          // The Done card (from the refreshed status) takes over from the progress panel.
          setProgress(0);
          setRerunning(false);
          refreshCacheStatus();
          if (data.message) setLogs(prev => [...prev, { kind: 'ok', text: data.message }]);
          setGenerating(false);
        } else if (data.status === 'error') {
          completed = true;
          setLogs(prev => [...prev, { kind: 'error', text: t('ins.log.error', { reason: data.message || data.error || '' }) }]);
          setGenerating(false);
        }
      };

      try {
        await stream.start(endpoint, body, { onEvent: handleStreamEvent });
      } catch (e) {
        if (e?.name === 'AbortError') {
          setGenerating(false);
          break;
        }
        setLogs(prev => [...prev, { kind: 'warn', text: t('ins.log.connection', { reason: e.message }) }]);
      } finally {
        refresh();
      }

      if (completed || !mountedRef.current) break;

      if (attempt < MAX_RETRIES) {
        setLogs(prev => [...prev, { kind: 'warn', text: `${t('ins.retrying')} (${attempt + 1}/${MAX_RETRIES})` }]);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        if (!mountedRef.current) break;
      } else {
        setLogs(prev => [...prev, { kind: 'error', text: t('ins.maxRetries') }]);
        setGenerating(false);
      }
    }
  };

  const activeModel = AVAILABLE_LLM_MODELS.find(m => m.id === selectedModel);
  const showDone = DONE_CARD_STATES.has(view.state) && !generating && !rerunning;

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100 transition-all duration-500">
      
      {/* Header */}
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-100">
        <div className="p-3 bg-gradient-to-tr from-violet-500 to-blue-500 text-white rounded-xl shadow-lg">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('step.insights')}</h2>
          <p className="text-gray-500 text-sm mt-1">{t('step.insights.lead')}</p>
        </div>
      </div>

      {showDone && (
        <DoneCard
          stepId="insights"
          stepView={view}
          summary={insights?.summary}
          completedAt={insights?.completed_at}
          onRunAgain={() => setRerunning(true)}
        >
          <ResultsPlaceholder summary={insights?.summary} />
        </DoneCard>
      )}

      {/* --- CONFIGURATION --- */}
      {!generating && progress === 0 && !showDone && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

          <div className="grid md:grid-cols-2 gap-6">

            {/* Model Selector */}
            <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
              <div className="flex items-center space-x-2 pb-2 border-b border-gray-50">
                <Icon name="tune" className="text-xl text-gray-500" />
                <h3 className="font-bold text-gray-800">{t('ins.model.title')}</h3>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto p-1">
                {AVAILABLE_LLM_MODELS.map(model => {
                  const isSelected = selectedModel === model.id;
                  return (
                    <button
                      type="button"
                      key={model.id}
                      onClick={() => selectAndStartModel(model)}
                      disabled={modelActivation.status === 'starting'}
                      className={`block w-full text-left p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 disabled:cursor-wait ${isSelected ? 'border-violet-500 bg-violet-50/50 shadow-sm' : 'border-gray-100 hover:border-gray-200 bg-white'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 transition-colors ${isSelected ? 'bg-violet-500' : 'border-2 border-gray-300'}`}>
                          {isSelected && <div className="w-2 h-2 bg-white rounded-full"></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-bold text-sm ${isSelected ? 'text-violet-900' : 'text-gray-700'}`}>{model.name}</p>
                              {model.recommended && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">{t('common.recommended')}</span>}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1">{model.size}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {modelActivation.message && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    modelActivation.status === 'ready'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : modelActivation.status === 'error'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : modelActivation.status === 'starting'
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-gray-200 bg-gray-50 text-gray-600'
                  }`}
                >
                  {modelActivation.message}
                </div>
              )}
              <details className="text-[11px] text-gray-400">
                <summary className="cursor-pointer">{t('action.advanced')}</summary>
                <p className="mt-1 break-all">{t('ins.modelId', { id: selectedModel })}</p>
              </details>
            </div>

            {/* Options Panel */}
            <div className="space-y-4">
              {/* Options */}
              <div className="p-6 bg-white border border-gray-100 shadow-sm rounded-2xl space-y-4">
                <div className="flex items-center space-x-2 pb-2 border-b border-gray-50">
                  <Icon name="settings" className="text-xl text-gray-500" />
                  <h3 className="font-bold text-gray-800">{t('ins.options')}</h3>
                </div>
                <label onClick={() => setClearCache(!clearCache)} className={`flex items-center p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ${clearCache ? 'border-amber-500 bg-amber-50/50' : 'border-gray-100 hover:border-gray-200 bg-white'}`}>
                  <div className={`flex items-center justify-center w-5 h-5 rounded flex-shrink-0 mr-3 transition-colors ${clearCache ? 'bg-amber-500' : 'border border-gray-300'}`}>
                    {clearCache && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${clearCache ? 'text-amber-900' : 'text-gray-700'}`}>{t('insights.clearCache')}</p>
                    <p className="text-xs text-gray-500">{t('ins.clearCache.lead')}</p>
                  </div>
                </label>

                <label className={`flex items-center p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ${allowModelDownload ? 'border-violet-500 bg-violet-50/50' : 'border-gray-100 hover:border-gray-200 bg-white'}`}>
                  <input
                    type="checkbox"
                    checked={allowModelDownload}
                    onChange={(e) => setAllowModelDownload(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`flex items-center justify-center w-5 h-5 rounded flex-shrink-0 mr-3 transition-colors ${allowModelDownload ? 'bg-violet-500' : 'border border-gray-300'}`}>
                    {allowModelDownload && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${allowModelDownload ? 'text-violet-900' : 'text-gray-700'}`}>{t('ins.autostart.title')}</p>
                    <p className="text-xs text-gray-500">{t('ins.autostart.lead')}</p>
                  </div>
                </label>

                <div className="p-3 rounded-xl border-2 border-gray-100 bg-white space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">{t('ins.filtered.title')}</p>
                  </div>
                  <p className="text-xs text-gray-500">{t('ins.filtered.hint')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'academic_year' },
                      { key: 'location' },
                      { key: 'programme' },
                      { key: 'study_mode' },
                      { key: 'language' },
                    ].map(dim => {
                      const size = dimensionSizes[dim.key] || 0;
                      const active = filterDimensions.includes(dim.key);
                      const disabled = size === 0;
                      return (
                        <button
                          type="button"
                          key={dim.key}
                          disabled={disabled}
                          onClick={() => toggleDimension(dim.key)}
                          className={`text-left px-2.5 py-1.5 rounded-lg border-2 transition-colors text-xs ${
                            active
                              ? 'border-violet-500 bg-violet-50/60 text-violet-900'
                              : disabled
                                ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                                : 'border-gray-100 hover:border-gray-200 bg-white text-gray-700'
                          }`}
                        >
                          <span className="font-semibold">{t('ins.dim.' + dim.key)}</span>
                          <span className="ml-1 text-[10px] text-gray-400">({size})</span>
                        </button>
                      );
                    })}
                  </div>
                  {filterDimensions.length > 0 && (
                    <div className={`text-xs rounded-lg px-2.5 py-2 border space-y-0.5 ${
                      extraThemeInsights > 500
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : extraThemeInsights > 150
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}>
                      <div>{t('insights.filtered', { count: extraThemeInsights, min: estimatedMinutes })}</div>
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl border-2 border-gray-100 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">{t('ins.docs.title')}</p>
                    <span className="text-sm font-bold text-primary tabular-nums">{maxDocuments}</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={totalDocs ?? 600}
                    step={60}
                    value={maxDocuments}
                    onChange={(e) => setMaxDocuments(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 font-medium">
                    <span>{t('ins.docs.fast', { n: 60 })}</span>
                    <span>{t('ins.docs.default', { n: 240 })}</span>
                    <span>{totalDocs ? t('ins.docs.all', { n: totalDocs }) : '…'}</span>
                  </div>
                  <p className="text-xs text-gray-500">{t('ins.docs.lead')}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Summary + 4 Launchers */}
          <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-800">{activeModel?.name}</span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-500">{t('ins.summary', { themes: THEME_COUNT, docs: maxDocuments })}</span>
              {filterDimensions.length > 0 && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-violet-600 font-medium text-xs">
                    {t('ins.summary.combos', { n: displayCombos })}
                  </span>
                </>
              )}
              {clearCache && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-amber-600 font-medium text-xs">{t('ins.summary.clear')}</span>
                </>
              )}
            </div>

            <GateReason stepId="insights" onNavigate={onNavigate} className="block mb-3" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => launchPrecompute({ endpoint: '/api/precompute-insights', useFilterGrid: false, label: 'ins.label.main' })}
                disabled={!view.canStart}
                className="px-5 py-3 bg-gradient-to-r from-violet-600 to-blue-600 text-white rounded-xl font-bold shadow hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm text-left"
              >
                <div className="flex items-center justify-between">
                  <span>{t('ins.btn.main')}</span>
                  <Icon name="arrow_forward" className="text-base" />
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-normal text-white/80">{t('ins.btn.main.lead', { n: THEME_COUNT })}</span>
                  <CacheBadge cached={cacheStatus.main_baseline} total={THEME_COUNT} />
                </div>
              </button>

              <button
                onClick={() => launchPrecompute({ endpoint: '/api/precompute-subthemes', useFilterGrid: false, label: 'ins.label.sub' })}
                disabled={!view.canStart}
                className="px-5 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-xl font-bold shadow hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm text-left"
              >
                <div className="flex items-center justify-between">
                  <span>{t('ins.btn.sub')}</span>
                  <Icon name="arrow_forward" className="text-base" />
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-normal text-white/80">{t('ins.btn.sub.lead')}</span>
                  <CacheBadge cached={cacheStatus.subtheme_baseline} />
                </div>
              </button>

              <button
                onClick={() => launchPrecompute({ endpoint: '/api/precompute-insights', useFilterGrid: true, label: 'ins.label.filtered' })}
                disabled={filterDimensions.length === 0 || !view.canStart}
                className="px-5 py-3 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl font-bold shadow hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm text-left"
              >
                <div className="flex items-center justify-between">
                  <span>{t('ins.btn.filtered')}</span>
                  <Icon name="arrow_forward" className="text-base" />
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-normal text-white/80">
                    {filterDimensions.length > 0 ? t('ins.btn.filtered.lead', { n: displayCombos, themes: THEME_COUNT }) : t('ins.btn.selectFirst')}
                  </span>
                  <CacheBadge cached={cacheStatus.main_filtered} total={filterDimensions.length > 0 ? extraThemeInsights : undefined} />
                </div>
              </button>

              <button
                onClick={() => launchPrecompute({ endpoint: '/api/precompute-subthemes', useFilterGrid: true, label: 'ins.label.filteredSub' })}
                disabled={filterDimensions.length === 0 || !view.canStart}
                className="px-5 py-3 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white rounded-xl font-bold shadow hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm text-left"
              >
                <div className="flex items-center justify-between">
                  <span>{t('ins.btn.filteredSub')}</span>
                  <Icon name="arrow_forward" className="text-base" />
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-normal text-white/80">
                    {filterDimensions.length > 0 ? t('ins.btn.filteredSub.lead') : t('ins.btn.selectFirst')}
                  </span>
                  <CacheBadge cached={cacheStatus.subtheme_filtered} />
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- GENERATING PROGRESS (also stays visible on error so logs don't vanish) --- */}
      {(generating || (progress > 0 && progress < 100)) && (
        <div className="space-y-3">
          <ProgressPanel stage={currentStage} progress={progress} logs={logs.map((log) => log.text)} />
          {/* Back button shown only when stopped mid-way (error state) */}
          {!generating && (
            <div className="flex items-center justify-between gap-3 flex-wrap p-4 bg-error-container text-error rounded-xl">
              <span className="font-semibold">{t('ins.stopped')}</span>
              <button
                type="button"
                onClick={() => { setProgress(0); setLogs([]); }}
                className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-white border border-outline-variant text-on-surface text-sm font-semibold hover:bg-surface-container-low"
              >
                <Icon name="arrow_back" className="text-base" />
                {t('ins.back')}
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
