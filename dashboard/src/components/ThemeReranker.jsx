import { useEffect, useState } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl } from '../services/api';

const DEFAULT_RERANKER = 'zeroentropy/zerank-2-reranker';

export default function ThemeReranker({ onSuccess }) {
  const stream = useNdjsonStream();
  const [status, setStatus] = useState(null);
  const [rerankerModel, setRerankerModel] = useState(DEFAULT_RERANKER);
  const [allowModelDownload, setAllowModelDownload] = useState(true);
  const [maxDocuments, setMaxDocuments] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(apiUrl('/api/status'));
        const data = await res.json();
        if (data.status === 'success') setStatus(data);
      } catch (e) {
        setStatus({ error: 'Could not connect to the backend.' });
      }
    };
    fetchStatus();
  }, []);

  const handleRerank = async () => {
    setLoading(true);
    setProgress(0);
    setCurrentStage('Preparing reranker pass...');
    setResult(null);

    try {
      const payload = {
        reranker_model: rerankerModel.trim() || DEFAULT_RERANKER,
        allow_model_download: allowModelDownload,
      };
      if (String(maxDocuments).trim()) {
        payload.max_documents = Number(maxDocuments);
      }

      await stream.start('/api/rerank-theme-assignments', payload, {
        onEvent: (data) => {
          if (data.status === 'progress') {
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.message) setCurrentStage(data.message);
          } else if (data.status === 'success') {
            setResult(data);
            setProgress(100);
            setCurrentStage('Reranker assignments finalized.');
            setTimeout(() => onSuccess?.(), 1200);
          } else if (data.status === 'error') {
            setResult({ error: data.error });
            setCurrentStage('Reranker failed.');
          }
        }
      });
    } catch (error) {
      setResult({ error: error.message });
      setCurrentStage('Reranker failed.');
    } finally {
      setLoading(false);
    }
  };

  const vectorReady = Boolean(status?.vector_db_ready);

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100">
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-100">
        <div className="p-3 bg-gradient-to-tr from-indigo-500 to-sky-500 text-white rounded-xl shadow-lg">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">Theme Reranker</h2>
          <p className="text-gray-500 text-sm mt-1">Resolve embedding-ambiguous rows into one final theme assignment</p>
        </div>
      </div>

      {!loading && !result && (
        <div className="space-y-6">
          {!vectorReady && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              Build the vector database before running the reranker stage.
            </div>
          )}

          {vectorReady && (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Vector DB</p>
                <p className="text-lg font-black text-slate-900 mt-1">Ready</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Reranker Status</p>
                <p className="text-lg font-black text-slate-900 mt-1">{status?.theme_reranker_status || 'not_run'}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current Model</p>
                <p className="text-sm font-black text-slate-900 mt-2 break-words">{status?.theme_reranker_model || 'disabled'}</p>
              </div>
            </div>
          )}

          <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
            <label className="block">
              <span className="text-sm font-bold text-gray-800">Reranker model</span>
              <input
                value={rerankerModel}
                onChange={(e) => setRerankerModel(e.target.value)}
                className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>

            <div className="grid md:grid-cols-2 gap-4">
              <label className="flex items-start gap-3 p-4 bg-gray-50 border border-gray-100 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowModelDownload}
                  onChange={(e) => setAllowModelDownload(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-bold text-gray-800">Download model if missing</p>
                  <p className="text-xs text-gray-500 mt-1">Disable this for cached-only reranker tests.</p>
                </div>
              </label>

              <label className="block p-4 bg-gray-50 border border-gray-100 rounded-xl">
                <span className="text-sm font-bold text-gray-800">Max documents</span>
                <input
                  value={maxDocuments}
                  onChange={(e) => setMaxDocuments(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="All ambiguous rows"
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-sm text-gray-600">
              Embedding-confident rows stay assigned; only ambiguous rows are checked.
            </div>
            <button
              onClick={handleRerank}
              disabled={!vectorReady || loading}
              className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-sky-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 disabled:opacity-50 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
            >
              Run Reranker
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="p-8 bg-gray-900 rounded-3xl shadow-2xl relative overflow-hidden ring-1 ring-white/10">
          <div className="absolute top-0 left-0 w-full h-1 bg-gray-800">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="relative z-10 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Resolving Theme Assignments</h3>
              <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-sky-300">{progress}%</span>
            </div>
            <div className="p-4 bg-black/40 rounded-xl border border-white/5">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">System Status</p>
              <p className="text-sky-300 font-mono text-sm">{currentStage}</p>
            </div>
          </div>
        </div>
      )}

      {result && !loading && (
        <div className={`p-6 rounded-2xl ${result.error ? 'bg-red-50 border border-red-100' : 'bg-emerald-50 border border-emerald-100'}`}>
          <h4 className={`text-lg font-bold ${result.error ? 'text-red-900' : 'text-emerald-900'}`}>
            {result.error ? 'Reranker Failed' : 'Final Theme Assignments Ready'}
          </h4>
          <p className={`mt-1 ${result.error ? 'text-red-700' : 'text-emerald-700'}`}>
            {result.error || 'Ambiguous embedding candidates were resolved to one final theme per response.'}
          </p>

          {!result.error && (
            <div className="mt-6 grid md:grid-cols-4 gap-4">
              <div className="bg-white/60 p-4 rounded-xl">
                <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">Reranked</p>
                <p className="text-2xl font-black text-emerald-700 mt-1">{result.reranked_documents}</p>
              </div>
              <div className="bg-white/60 p-4 rounded-xl">
                <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">Changed</p>
                <p className="text-2xl font-black text-emerald-700 mt-1">{result.changed_primary}</p>
              </div>
              <div className="bg-white/60 p-4 rounded-xl">
                <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">Low Info</p>
                <p className="text-2xl font-black text-emerald-700 mt-1">{result.low_information_reassigned}</p>
              </div>
              <div className="bg-white/60 p-4 rounded-xl">
                <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">Model</p>
                <p className="text-xs font-black text-emerald-700 mt-2 break-words">{result.reranker_model}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
