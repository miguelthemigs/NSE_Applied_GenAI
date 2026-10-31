import { useState, useEffect } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl } from '../services/api';

const AVAILABLE_MODELS = [
  {
    id: 'Octen/Octen-Embedding-0.6B',
    name: 'Octen Embedding 0.6B',
    provider: 'Octen',
    description: 'Default compact Octen embedding model. Best starting point for local iteration before moving to larger Octen variants.',
    role: 'Compact',
    silhouette: null,
    daviesBouldin: null,
    embedTime: 'Fastest Octen',
    languages: 'Multilingual',
    recommended: true
  },
  {
    id: 'Octen/Octen-Embedding-4B',
    name: 'Octen Embedding 4B',
    provider: 'Octen',
    description: 'Medium Octen embedding model for better retrieval quality when you can spend more memory and inference time.',
    role: 'Balanced',
    silhouette: null,
    daviesBouldin: null,
    embedTime: 'Moderate',
    languages: 'Multilingual',
    recommended: false
  },
  {
    id: 'Octen/Octen-Embedding-8B',
    name: 'Octen Embedding 8B',
    provider: 'Octen',
    description: 'Largest Octen embedding option for maximum semantic retrieval quality on capable hardware.',
    role: 'High capacity',
    silhouette: null,
    daviesBouldin: null,
    embedTime: 'Slow',
    languages: 'Multilingual',
    recommended: false
  }
];

export default function VectorDBBuilder({ onSuccess }) {
  const stream = useNdjsonStream();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
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
          setConfigError(data.error || 'Could not load columns');
        }
      } catch (e) {
        setConfigError('Could not connect to the backend. Is the Flask server running?');
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
    setCurrentStage('Initializing Connection...');
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
            if (data.message) setCurrentStage(data.message);
            if (data.current_doc) setCurrentDoc(data.current_doc);
          } else if (data.status === 'success') {
            setResult(data);
            setProgress(100);
            setCurrentStage('Embeddings Generated and Indexed!');
            setTimeout(() => onSuccess?.(), 2000);
          } else if (data.status === 'error') {
            setResult({ error: data.error });
          }
        }
      });
    } catch (error) {
      setResult({ error: error.message });
      setCurrentStage('Error occurred');
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
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">Semantic Vector Database</h2>
          <p className="text-gray-500 text-sm mt-1">Configure and build high-dimensional semantic vectors from your anonymized data</p>
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
                    <p className="font-bold text-amber-900">Onderbroken vector build gevonden</p>
                    <p className="text-sm text-amber-700 mt-1">
                      <span className="font-semibold">{vectorCheckpoint.processed_count.toLocaleString()} van {vectorCheckpoint.total_docs.toLocaleString()}</span> documenten al geïndexeerd
                      {vectorCheckpoint.embedding_model && <span className="ml-1">— model: <span className="font-mono">{vectorCheckpoint.embedding_model.split('/').pop()}</span></span>}
                    </p>
                    <p className="text-xs text-amber-600 mt-1">Je kunt verdergaan zonder opnieuw te beginnen.</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setVectorCheckpoint(null)}
                    className="px-3 py-2 bg-white text-amber-700 text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all ring-1 ring-amber-300"
                  >
                    Negeren
                  </button>
                  <button
                    onClick={() => handleBuild(vectorCheckpoint.embedding_model, vectorCheckpoint.selected_columns)}
                    className="px-5 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-amber-600 transition-all"
                  >
                    Verdergaan
                  </button>
                </div>
              </div>
            </div>
          )}

          {configError && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              <span>{configError}</span>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">

            {/* Column Selector */}
            <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
              <div className="flex items-center justify-between pb-2 border-b border-gray-50">
                <div className="flex items-center space-x-2">
                  <span className="text-xl">📋</span>
                  <h3 className="font-bold text-gray-800">Columns to Vectorize</h3>
                </div>
                {configLoaded && (
                  <span className="text-xs text-gray-400 font-medium">{rowCount} rows</span>
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
                  {configError ? 'Unavailable' : 'Loading columns...'}
                </div>
              )}
              <p className="text-xs text-gray-400">{selectedColumns.length} of {columns.length} columns selected</p>
            </div>

            {/* Model Selector */}
            <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
              <div className="flex items-center space-x-2 pb-2 border-b border-gray-50">
                <span className="text-xl">🧠</span>
                <h3 className="font-bold text-gray-800">Embedding Model</h3>
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
                            <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{model.provider}</span>
                            {model.recommended && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">Default</span>}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{model.description}</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {typeof model.silhouette === 'number' ? (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${model.silhouette >= 0.92 ? 'bg-emerald-100 text-emerald-700' : model.silhouette >= 0.90 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                Silhouette: {model.silhouette.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700">{model.role}</span>
                            )}
                            {typeof model.daviesBouldin === 'number' && (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${model.daviesBouldin <= 0.20 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                DB: {model.daviesBouldin.toFixed(2)}
                              </span>
                            )}
                            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">⚡ {model.embedTime}</span>
                            <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">🌍 {model.languages}</span>
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400">Choose between compact, balanced, and high-capacity Octen embeddings</p>
            </div>
          </div>

          <label className="flex items-start gap-3 p-4 bg-white border border-gray-100 rounded-xl shadow-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allowModelDownload}
              onChange={(e) => setAllowModelDownload(e.target.checked)}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-bold text-gray-800">Download model if missing</p>
              <p className="text-xs text-gray-500 mt-1">
                When disabled, the build only uses locally cached models and fails before changing ChromaDB if the selected model is unavailable.
              </p>
            </div>
          </label>

          {/* Summary + Launch */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-800">{selectedColumns.length}</span> column{selectedColumns.length !== 1 ? 's' : ''} × <span className="font-semibold text-gray-800">{rowCount}</span> rows → <span className="font-semibold text-fuchsia-700">{activeModel?.name || selectedModel}</span>
            </div>
            <button
              onClick={() => handleBuild()}
              disabled={loading || selectedColumns.length === 0}
              className="px-8 py-3 bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white rounded-xl font-bold shadow-lg shadow-fuchsia-200 disabled:opacity-50 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
            >
              Launch Vector Builder 🚀
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
                  Building Vector Embeddings
                </h3>
                <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-rose-400">
                  {progress}%
                </span>
              </div>

              {/* Active model badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-fuchsia-300 bg-fuchsia-500/20 px-2 py-1 rounded-md">Model: {activeModel?.name || selectedModel}</span>
                <span className="text-xs font-medium text-rose-300 bg-rose-500/20 px-2 py-1 rounded-md">{selectedColumns.length} column{selectedColumns.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-4 bg-black/40 rounded-xl border border-white/5 backdrop-blur-sm">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">System Status</p>
                  <p className="text-fuchsia-300 font-mono text-sm tracking-tight flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin text-fuchsia-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {currentStage}
                  </p>
                </div>

                <div className="p-4 bg-black/40 rounded-xl border border-white/5 backdrop-blur-sm min-h-[100px] flex flex-col justify-center">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Live Encoding Stream</p>
                  {currentDoc ? (
                    <div className="text-gray-200 text-sm font-mono leading-relaxed line-clamp-2 animate-in fade-in">
                      <span className="text-rose-400 mr-2 font-bold">~</span>
                      {currentDoc}
                    </div>
                  ) : (
                    <div className="flex gap-1.5 items-center mt-1">
                       <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-bounce"></span>
                       <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-bounce" style={{animationDelay: '0.2s'}}></span>
                       <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-bounce" style={{animationDelay: '0.4s'}}></span>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Steps Indicator */}
              <div className="flex items-center gap-2 pt-2">
                {['Load Model', 'Read Data', 'Encode Vectors', 'Save to DB'].map((stepName, i) => {
                  const stepProgress = (i + 1) * 25;
                  const isActive = progress >= stepProgress - 15;
                  return (
                    <div key={stepName} className="flex-1">
                      <div className={`h-1.5 rounded-full mb-2 transition-colors duration-500 ${isActive ? 'bg-fuchsia-500' : 'bg-gray-700'}`}></div>
                      <p className={`text-[10px] uppercase font-bold tracking-wider text-center transition-colors duration-500 ${isActive ? 'text-fuchsia-300' : 'text-gray-600'}`}>{stepName}</p>
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
              {result.error ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              )}
            </div>
            <div className="flex-1">
              <h4 className={`text-lg font-bold ${result.error ? 'text-red-900' : 'text-emerald-900'}`}>
                {result.error ? 'Vector DB Generation Failed' : 'Knowledge Base Ready'}
              </h4>
              <p className={`mt-1 ${result.error ? 'text-red-700' : 'text-emerald-700'}`}>
                {result.error || 'Successfully processed all anonymized records into high-dimensional semantic space.'}
              </p>
              
              {!result.error && (
                <div className="mt-6 grid grid-cols-3 gap-4">
                  <div className="bg-white/60 p-4 rounded-xl">
                    <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">Documents Indexed</p>
                    <p className="text-3xl font-black text-emerald-700 mt-1">{result.document_count}</p>
                  </div>
                  <div className="bg-white/60 p-4 rounded-xl">
                    <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">Vectors Created</p>
                    <p className="text-3xl font-black text-emerald-700 mt-1">{result.vectors_created}</p>
                  </div>
                  <div className="bg-white/60 p-4 rounded-xl">
                    <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">Model Used</p>
                    <p className="text-lg font-black text-emerald-700 mt-1">{activeModel?.name || selectedModel}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
