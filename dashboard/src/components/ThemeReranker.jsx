import { useEffect, useState } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl, postJson } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';
import GateReason from './pipeline/GateReason';
import { usePipelineStatus } from '../context/PipelineStatusContext';
import { deriveStepView } from '../utils/stepView';

const DEFAULT_RERANKER = 'zeroentropy/zerank-2-reranker';

export default function ThemeReranker({ onNavigate }) {
  const { t, formatNumber } = useI18n();
  const stream = useNdjsonStream();
  const { status: pipeline, refresh } = usePipelineStatus();
  const view = deriveStepView(pipeline, 'rerank');
  const vectorsAt = pipeline?.steps?.vectors?.completed_at;
  const [status, setStatus] = useState(null);
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState(null);
  const [rerankerModel, setRerankerModel] = useState(DEFAULT_RERANKER);
  const [allowModelDownload, setAllowModelDownload] = useState(true);
  const [maxDocuments, setMaxDocuments] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(apiUrl('/api/status'));
        const data = await res.json();
        if (data.status === 'success') setStatus(data);
      } catch (e) {
        setStatus({ error: 'connect' });
      }
    };
    fetchStatus();
  }, [vectorsAt]);

  // Skipping is saved server-side; the response is the new pipeline status.
  const handleSkip = async () => {
    setSkipping(true);
    setSkipError(null);
    try {
      const res = await postJson('/api/pipeline/skip-rerank', { skipped: true });
      if (res.ok) onNavigate?.('insights');
      else setSkipError(res.data?.error || res.data?.message || `HTTP ${res.status}`);
    } catch (e) {
      setSkipError(e.message);
    } finally {
      setSkipping(false);
      refresh();
    }
  };

  const handleRerank = async () => {
    setLoading(true);
    setProgress(0);
    setCurrentStage('');
    setLogs([]);
    setResult(null);

    let sawEvent = false;
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
          if (!sawEvent) {
            sawEvent = true;
            refresh();
          }
          if (data.status === 'progress') {
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.stage) setCurrentStage(data.stage);
            if (data.message) setLogs(prev => [...prev, data.message]);
          } else if (data.status === 'success') {
            setResult(data);
            setProgress(100);
            setCurrentStage('save');
          } else if (data.status === 'error') {
            setResult({ error: data.error });
          }
        }
      });
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setLoading(false);
      refresh();
    }
  };

  const vectorReady = !view.blockedBy && Boolean(pipeline);
  const showSkip = !['done', 'skipped', 'stale'].includes(view.state);

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100">
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-100">
        <div className="p-3 bg-gradient-to-tr from-indigo-500 to-sky-500 text-white rounded-xl shadow-lg">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('step.rerank')}</h2>
          <p className="text-gray-500 text-sm mt-1">{t('step.rerank.lead')}</p>
        </div>
      </div>

      {!loading && !result && (
        <div className="space-y-6">
          {vectorReady && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t('rerank.status')}</p>
              <p className="text-lg font-black text-slate-900 mt-1">
                {t(view.state === 'stale' || view.state === 'skipped' || view.state === 'done' ? 'state.' + view.state : 'state.not_started')}
              </p>
            </div>
          )}

          <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
            <div className="grid md:grid-cols-2 gap-4">
              <label className="flex items-start gap-3 p-4 bg-gray-50 border border-gray-100 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowModelDownload}
                  onChange={(e) => setAllowModelDownload(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-bold text-gray-800">{t('vec.download.title')}</p>
                  <p className="text-xs text-gray-500 mt-1">{t('rerank.download.lead')}</p>
                </div>
              </label>

              <label className="block p-4 bg-gray-50 border border-gray-100 rounded-xl">
                <span className="text-sm font-bold text-gray-800">{t('rerank.max.title')}</span>
                <input
                  value={maxDocuments}
                  onChange={(e) => setMaxDocuments(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder={t('rerank.max.placeholder')}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </div>

            <details>
              <summary className="text-sm font-bold text-gray-800 cursor-pointer">{t('action.advanced')}</summary>
              <label className="block mt-3">
                <span className="text-sm font-bold text-gray-800">{t('rerank.model')}</span>
                <input
                  value={rerankerModel}
                  onChange={(e) => setRerankerModel(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {status?.theme_reranker_model && (
                  <span className="block mt-1 text-xs text-gray-500 break-words">{status.theme_reranker_model}</span>
                )}
              </label>
            </details>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-sm text-gray-600">
              {t('rerank.hint')}
            </div>
            {showSkip && (
              <button
                type="button"
                onClick={handleSkip}
                disabled={!view.canStart || skipping}
                className="min-h-[44px] px-1 py-2.5 text-sm font-semibold text-primary underline underline-offset-[3px] hover:text-primary-container disabled:opacity-50 disabled:no-underline"
              >
                {t('action.skip')}
              </button>
            )}
            <GateReason stepId="rerank" onNavigate={onNavigate} className="ml-auto" />
            {skipError && (
              <div role="alert" className="basis-full order-last rounded-xl bg-error-container text-on-error-container px-4 py-3 text-sm">
                <p className="m-0 font-semibold">{t('rerank.skipFailed')}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer">{t('action.details')}</summary>
                  <p className="mt-1 break-words">{skipError}</p>
                </details>
              </div>
            )}
            <button
              onClick={handleRerank}
              disabled={!view.canStart || loading}
              className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-sky-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 disabled:opacity-50 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
            >
              {t('rerank.start')}
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
              <h3 className="text-xl font-bold text-white">{t('state.working')}</h3>
              <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-sky-300">{progress}%</span>
            </div>
            <div className="p-4 bg-black/40 rounded-xl border border-white/5">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">{t('rerank.status')}</p>
              <p className="text-sky-300 font-mono text-sm">{currentStage ? t('stage.' + currentStage) : t('state.working')}</p>
            </div>
            <details className="p-4 bg-black/40 rounded-xl border border-white/5">
              <summary className="text-xs text-gray-400 font-semibold uppercase tracking-wider cursor-pointer">{t('action.details')}</summary>
              <div className="mt-2 max-h-40 overflow-y-auto text-gray-300 text-xs font-mono space-y-1">
                {logs.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            </details>
          </div>
        </div>
      )}

      {result && !loading && (
        <div className={`p-6 rounded-2xl ${result.error ? 'bg-red-50 border border-red-100' : 'bg-emerald-50 border border-emerald-100'}`}>
          <h4 className={`text-lg font-bold ${result.error ? 'text-red-900' : 'text-emerald-900'}`}>
            {result.error ? t('rerank.failed') : t('state.done')}
          </h4>
          {result.error ? (
            <details className="mt-2 text-sm text-red-700">
              <summary className="cursor-pointer">{t('action.details')}</summary>
              <p className="mt-1 break-words">{result.error}</p>
            </details>
          ) : (
            <>
              <p className="mt-1 text-emerald-700">
                {t('done.rerank', {
                  checked: formatNumber(result.reranked_documents ?? 0),
                  changed: formatNumber(result.changed_primary ?? 0),
                  lowinfo: formatNumber(result.low_information_reassigned ?? 0),
                })}
              </p>
              <div className="mt-6 grid md:grid-cols-3 gap-4">
                <div className="bg-white/60 p-4 rounded-xl">
                  <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">{t('rerank.done.reread')}</p>
                  <p className="text-2xl font-black text-emerald-700 mt-1">{result.reranked_documents}</p>
                </div>
                <div className="bg-white/60 p-4 rounded-xl">
                  <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">{t('rerank.done.changed')}</p>
                  <p className="text-2xl font-black text-emerald-700 mt-1">{result.changed_primary}</p>
                </div>
                <div className="bg-white/60 p-4 rounded-xl">
                  <p className="text-emerald-600/70 text-xs font-bold uppercase tracking-wider">{t('rerank.done.lowinfo')}</p>
                  <p className="text-2xl font-black text-emerald-700 mt-1">{result.low_information_reassigned}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('insights')}
                className="mt-6 inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-primary text-on-primary font-semibold hover:bg-primary-container"
              >
                {t('action.continue', { n: 4 })}
                <Icon name="arrow_forward" className="text-[18px]" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
