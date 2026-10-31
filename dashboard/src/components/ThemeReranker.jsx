import { useEffect, useState } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl, postJson } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import GateReason from './pipeline/GateReason';
import ProgressPanel from './pipeline/ProgressPanel';
import Icon from './Icon';
import DoneCard from './pipeline/DoneCard';
import { usePipelineStatus } from '../context/PipelineStatusContext';
import { deriveStepView } from '../utils/stepView';
import { DONE_CARD_STATES } from '../utils/doneMessage';
import { downloadFromEvent, streamErrorKey } from '../utils/downloadProgress';

const DEFAULT_RERANKER = 'zeroentropy/zerank-2-reranker';

export default function ThemeReranker({ onNavigate }) {
  const { t } = useI18n();
  const stream = useNdjsonStream();
  const { status: pipeline, refresh } = usePipelineStatus();
  const view = deriveStepView(pipeline, 'rerank');
  const vectorsAt = pipeline?.steps?.vectors?.completed_at;
  const rerank = pipeline?.steps?.rerank;
  const [status, setStatus] = useState(null);
  // True while the user sets up a new run (or reads its error) instead of the Done card.
  const [rerunning, setRerunning] = useState(false);
  // A run succeeded but the status that shows it could not be loaded.
  const [statusNotice, setStatusNotice] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState(null);
  const [rerankerModel, setRerankerModel] = useState(DEFAULT_RERANKER);
  const [allowModelDownload, setAllowModelDownload] = useState(true);
  const [maxDocuments, setMaxDocuments] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [logs, setLogs] = useState([]);
  const [download, setDownload] = useState(null);
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
    setRerunning(true);
    setStatusNotice(false);
    setProgress(0);
    setCurrentStage('');
    setLogs([]);
    setDownload(null);
    setResult(null);

    let sawEvent = false;
    let succeeded = false;
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
            setDownload(downloadFromEvent(data));
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.stage) setCurrentStage(data.stage);
            if (data.message) setLogs(prev => [...prev, data.message]);
          } else if (data.status === 'success') {
            setDownload(null);
            setProgress(100);
            setCurrentStage('save');
            succeeded = true;
          } else if (data.status === 'error') {
            setDownload(null);
            setResult({ error: data.error, code: data.code });
          }
        }
      });
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      // Keep the panel until the refreshed status shows the result (no blank step).
      const refreshed = await refresh();
      setLoading(false);
      if (succeeded) {
        setRerunning(false);
        if (!refreshed?.status) setStatusNotice(true);
      }
    }
  };

  const vectorReady = !view.blockedBy && Boolean(pipeline);
  const showSkip = !['done', 'skipped', 'stale'].includes(view.state);
  const showDone = DONE_CARD_STATES.has(view.state) && !loading && !rerunning;

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100">
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-100">
        <div className="p-3 bg-gradient-to-tr from-indigo-500 to-sky-500 text-white rounded-xl shadow-lg">
          <Icon name="forum" className="text-2xl" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('step.rerank')}</h2>
          <p className="text-gray-500 text-sm mt-1">{t('step.rerank.lead')}</p>
        </div>
      </div>

      {showDone && (
        <DoneCard
          stepId="rerank"
          stepView={view}
          summary={rerank?.summary}
          completedAt={rerank?.completed_at}
          onContinue={() => onNavigate?.('insights')}
          onRunAgain={() => { setResult(null); setRerunning(true); }}
        />
      )}

      {statusNotice && !showDone && (
        <p role="alert" className="m-0 rounded-xl bg-error-container text-on-error-container px-4 py-3 font-medium">{t('pipeline.statusError')}</p>
      )}

      {result?.error && !loading && !showDone && (
        <div role="alert" className="p-5 rounded-2xl bg-error-container text-on-error-container">
          <p className="m-0 font-bold">{t(streamErrorKey(result.code) ?? 'rerank.failed')}</p>
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer">{t('action.details')}</summary>
            <p className="mt-1 break-words">{result.error}</p>
          </details>
        </div>
      )}

      {!loading && !showDone && (
        <div className="space-y-6">
          {DONE_CARD_STATES.has(view.state) && (
            <button
              type="button"
              onClick={() => { setResult(null); setRerunning(false); }}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest text-primary text-sm font-semibold hover:bg-surface-container-low"
            >
              <Icon name="arrow_back" className="text-[18px]" />
              {t('action.viewResults')}
            </button>
          )}
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

      {loading && <ProgressPanel stage={currentStage} progress={progress} logs={logs} download={download ?? undefined} />}

    </div>
  );
}
