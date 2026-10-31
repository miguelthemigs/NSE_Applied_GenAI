import { useState, useEffect } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';

const AVAILABLE_MODELS = [
  {
    id: 'Octen/Octen-Embedding-0.6B',
    name: 'Octen Embedding 0.6B',
    role: 'compact',
    recommended: true
  },
  {
    id: 'Octen/Octen-Embedding-4B',
    name: 'Octen Embedding 4B',
    role: 'balanced',
    recommended: false
  },
  {
    id: 'Octen/Octen-Embedding-8B',
    name: 'Octen Embedding 8B',
    role: 'high',
    recommended: false
  }
];

export default function VectorDBBuilder({ onSuccess }) {
  const { t, formatNumber } = useI18n();
  const stream = useNdjsonStream();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentDoc, setCurrentDoc] = useState('');

  // Configuration state
  const [columns, setColumns] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [selectedModel, setSelectedModel] = useState('Octen/Octen-Embedding-0.6B');
  const [allowModelDownload, setAllowModelDownload] = useState(true);
  const [rowCount, setRowCount] = useState(0);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState(null);
  const [vectorCheckpoint, setVectorCheckpoint] = useState(null);

  // Load columns and checkpoint status on mount
  useEffect(() => {
    const fetchColumns = async () => {
      try {
        const res = await fetch(apiUrl('/api/inspect-anonymized'));
        const data = await res.json();
        if (data.status === 'success') {
          setColumns(data.text_columns || []);
          setSelectedColumns(data.text_columns || []);
          setRowCount(data.row_count || 0);
          setConfigLoaded(true);
        } else {
          setConfigError('columns');
        }
      } catch (e) {
        setConfigError('connect');
      }
    };
    const fetchCheckpoint = async () => {
      try {
        const res = await fetch(apiUrl('/api/vector-checkpoint-status'));
        const data = await res.json();
        if (data.has_checkpoint) setVectorCheckpoint(data);
      } catch (e) {}
    };
    fetchColumns();
    fetchCheckpoint();
  }, []);

  const toggleColumn = (col) => {
    setSelectedColumns(prev =>
      prev.includes(col)
        ? prev.filter(c => c !== col)
        : [...prev, col]
    );
  };

  const handleBuild = async (overrideModel = null, overrideCols = null) => {
    const model = overrideModel ?? selectedModel;
    const cols = overrideCols ?? selectedColumns;
    if (cols.length === 0) return;

    setLoading(true);
    setProgress(0);
    setCurrentStage('');
    setLogs([]);
    setCurrentDoc('');
    setResult(null);
    setVectorCheckpoint(null);

    try {
      await stream.start('/api/build-vectors', {
        embedding_model: model,
        selected_columns: cols,
        allow_model_download: allowModelDownload
      }, {
        onEvent: (data) => {
          if (data.status === 'progress') {
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.stage) setCurrentStage(data.stage);
            if (data.message) setLogs(prev => [...prev, data.message]);
            if (data.current_doc) setCurrentDoc(data.current_doc);
          } else if (data.status === 'success') {
            setResult(data);
            setProgress(100);
            setCurrentStage('save');
            setTimeout(() => onSuccess?.(), 2000);
          } else if (data.status === 'error') {
            setResult({ error: data.error });
            if (data.error) setLogs(prev => [...prev, data.error]);
          }
        }
      });
    } catch (error) {
      setResult({ error: error.message });
      setLogs(prev => [...prev, error.message]);
    } finally {
      setLoading(false);
    }
  };

  const activeModel = AVAILABLE_MODELS.find(m => m.id === selectedModel);

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100 transition-all duration-500">
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-100">
        <div className="p-3 bg-gradient-to-tr from-fuchsia-500 to-rose-500 text-white rounded-xl shadow-lg">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('step.vectors')}</h2>
          <p className="text-gray-500 text-sm mt-1">{t('step.vectors.lead')}</p>
        </div>
      </div>

      {/* --- CONFIGURATION PANEL --- */}
      {!loading && !result && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">

          {vectorCheckpoint && (
            <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 rounded-xl shrink-0">
                    <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" /></svg>
                  </div>
                  <div>
                    <p className="font-bold text-amber-900">{t('vec.checkpoint.title', { x: formatNumber(vectorCheckpoint.processed_count), y: formatNumber(vectorCheckpoint.total_docs) })}</p>
                    <p className="text-xs text-amber-600 mt-1">{t('anon.interrupted.hint')}</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setVectorCheckpoint(null)}
                    className="px-3 py-2 bg-white text-amber-700 text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all ring-1 ring-amber-300"
                  >
                    {t('anon.restart')}
                  </button>
                  <button
                    onClick={() => handleBuild(vectorCheckpoint.embedding_model, vectorCheckpoint.selected_columns)}
                    className="px-5 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-amber-600 transition-all"
                  >
                    {t('anon.resume')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {configError && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              <span>{configError === 'columns' ? t('vec.err.columns') : t('vec.err.connect')}</span>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">

            {/* Column Selector */}
            <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
              <div className="flex items-center justify-between pb-2 border-b border-gray-50">
                <div className="flex items-center space-x-2">
                  <Icon name="view_column" className="text-xl text-gray-500" />
                  <h3 className="font-bold text-gray-800">{t('vec.columns.title')}</h3>
                </div>
                {configLoaded && (
                  <span className="text-xs text-gray-400 font-medium">{t('vec.rows', { n: formatNumber(rowCount) })}</span>
                )}
              </div>
              {configLoaded ? (
                <div className="space-y-2 max-h-52 overflow-y-auto p-1">
                  {columns.map(col => {
                    const isSelected = selectedColumns.includes(col);
                    return (
                      <label key={col} onClick={() => toggleColumn(col)} className={`flex items-center p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ${isSelected ? 'border-fuchsia-500 bg-fuchsia-50/50' : 'border-gray-100 hover:border-gray-200 bg-white'}`}>
                        <div className={`flex items-center justify-center w-5 h-5 rounded flex-shrink-0 mr-3 transition-colors ${isSelected ? 'bg-fuchsia-500' : 'border border-gray-300'}`}>
                          {isSelected && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </div>
                        <span className={`text-sm truncate font-medium ${isSelected ? 'text-fuchsia-900' : 'text-gray-600'}`} title={col}>{col}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                  {configError ? t('vec.columns.unavailable') : t('vec.columns.loading')}
                </div>
              )}
              <p className="text-xs text-gray-400">{t('vec.columns.chosen', { x: selectedColumns.length, y: columns.length })}</p>
            </div>

            {/* Model Selector */}
            <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
              <div className="flex items-center space-x-2 pb-2 border-b border-gray-50">
                <Icon name="tune" className="text-xl text-gray-500" />
                <h3 className="font-bold text-gray-800">{t('vec.model.title')}</h3>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto p-1">
                {AVAILABLE_MODELS.map(model => {
                  const isSelected = selectedModel === model.id;
                  return (
                    <label key={model.id} onClick={() => setSelectedModel(model.id)} className={`block p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ${isSelected ? 'border-fuchsia-500 bg-fuchsia-50/50 shadow-sm' : 'border-gray-100 hover:border-gray-200 bg-white'}`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 transition-colors ${isSelected ? 'bg-fuchsia-500' : 'border-2 border-gray-300'}`}>
                          {isSelected && <div className="w-2 h-2 bg-white rounded-full"></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-bold text-sm ${isSelected ? 'text-fuchsia-900' : 'text-gray-700'}`}>{model.name}</p>
                            {model.recommended && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">{t('common.recommended')}</span>}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{t('vec.role.' + model.role)}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <details className="p-4 bg-white border border-gray-100 rounded-xl shadow-sm">
            <summary className="text-sm font-bold text-gray-800 cursor-pointer">{t('action.advanced')}</summary>
            <label className="flex items-start gap-3 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowModelDownload}
                onChange={(e) => setAllowModelDownload(e.target.checked)}
                className="mt-1"
              />
              <div>
                <p className="text-sm font-bold text-gray-800">{t('vec.download.title')}</p>
                <p className="text-xs text-gray-500 mt-1">{t('vec.download.lead')}</p>
              </div>
            </label>
          </details>

          {/* Summary and start button */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-sm text-gray-600">
              {t('vec.summary', { r: formatNumber(rowCount), model: activeModel?.name || selectedModel })}
            </div>
            <button
              onClick={() => handleBuild()}
              disabled={loading || selectedColumns.length === 0}
              className="px-8 py-3 bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white rounded-xl font-bold shadow-lg shadow-fuchsia-200 disabled:opacity-50 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
            >
              {t('step.vectors')}
            </button>
          </div>
        </div>
      )}

      {/* --- BUILDING PROGRESS --- */}
      {loading && (
        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
          <div className="p-8 bg-gray-900 rounded-3xl shadow-2xl relative overflow-hidden ring-1 ring-white/10">
            {/* Animated Background Gradients */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-fuchsia-500/20 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-rose-500/20 rounded-full blur-3xl"></div>

            <div className="absolute top-0 left-0 w-full h-1 bg-gray-800">
              <div 
                className="h-full bg-gradient-to-r from-fuchsia-500 via-rose-500 to-orange-500 transition-all duration-500 ease-out" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>

            <div className="flex flex-col gap-6 relative z-10">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-3">
                  <div className="relative flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-fuchsia-500"></span>
                  </div>
                  {t('state.working')}
                </h3>
                <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-rose-400">
                  {progress}%
                </span>
              </div>

              {/* Active model badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-fuchsia-300 bg-fuchsia-500/20 px-2 py-1 rounded-md">{t('common.model')}: {activeModel?.name || selectedModel}</span>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-4 bg-black/40 rounded-xl border border-white/5 backdrop-blur-sm">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">{t('rerank.status')}</p>
                  <p className="text-fuchsia-300 font-mono text-sm tracking-tight flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin text-fuchsia-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {currentStage ? t('stage.' + currentStage) : t('state.working')}
                  </p>
                </div>

                <details className="p-4 bg-black/40 rounded-xl border border-white/5 backdrop-blur-sm min-h-[100px]">
                  <summary className="text-xs text-gray-400 font-semibold uppercase tracking-wider cursor-pointer">{t('action.details')}</summary>
                  <div className="mt-2 max-h-40 overflow-y-auto text-gray-300 text-xs font-mono leading-relaxed space-y-1">
                    {logs.map((line, i) => <div key={i}>{line}</div>)}
                    {currentDoc && <div className="line-clamp-2">{currentDoc}</div>}
                  </div>
                </details>
              </div>

              {/* Progress Steps Indicator */}
              <div className="flex items-center gap-2 pt-2">
                {['load', 'read', 'process', 'save'].map((stepName, i) => {
                  const stepProgress = (i + 1) * 25;
                  const isActive = progress >= stepProgress - 15;
                  return (
                    <div key={stepName} className="flex-1">
                      <div className={`h-1.5 rounded-full mb-2 transition-colors duration-500 ${isActive ? 'bg-fuchsia-500' : 'bg-gray-700'}`}></div>
                      <p className={`text-[10px] uppercase font-bold tracking-wider text-center transition-colors duration-500 ${isActive ? 'text-fuchsia-300' : 'text-gray-600'}`}>{t('stage.' + stepName)}</p>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* --- RESULT --- */}
      {result && !loading && (
        <div className={`p-6 rounded-2xl animate-in fade-in slide-in-from-bottom-4 ${result.error ? 'bg-red-50 border border-red-100' : 'bg-emerald-50 border border-emerald-100'}`}>
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-full ${result.error ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
              <Icon name={result.error ? 'error' : 'check_circle'} className="text-2xl" />
            </div>
            <div className="flex-1">
              <h4 className={`text-lg font-bold ${result.error ? 'text-red-900' : 'text-emerald-900'}`}>
                {result.error ? t('state.error') : t('state.done')}
              </h4>
              {result.error ? (
                <details className="mt-2 text-sm text-red-700">
                  <summary className="cursor-pointer">{t('action.details')}</summary>
                  <p className="mt-1 break-words">{result.error}</p>
                </details>
              ) : (
                <>
                  <p className="mt-1 text-emerald-700">
                    {t('done.vectors', { docs: formatNumber(result.document_count ?? 0), tier: activeModel?.name || selectedModel })}
                  </p>
                  <div className="mt-6 grid grid-cols-2 gap-4">
                    <div className="bg-white/60 p-4 rounded-xl">
                      <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">{t('common.answers')}</p>
                      <p className="text-3xl font-black text-emerald-700 mt-1">{result.document_count}</p>
                    </div>
                    <div className="bg-white/60 p-4 rounded-xl">
                      <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">{t('common.model')}</p>
                      <p className="text-lg font-black text-emerald-700 mt-1">{activeModel?.name || selectedModel}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
