import { useEffect, useState } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl, postJson } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import GateReason from './pipeline/GateReason';
import ProgressPanel from './pipeline/ProgressPanel';
import Icon from './Icon';
import DoneCard from './pipeline/DoneCard';
import StepHeader from './pipeline/StepHeader';
import {
  advancedBody, advancedDetails, advancedSummary, checkbox, errorBox, fieldLabel, linkButton, noteBox,
  primaryButton, secondaryButton, stepBody, stepFooter, textInput,
} from './pipeline/stepStyles';
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

  const showSkip = !['done', 'skipped', 'stale'].includes(view.state);
  const showDone = DONE_CARD_STATES.has(view.state) && !loading && !rerunning;

  return (
    <>
      <StepHeader stepId="rerank" />

      {showDone ? (
        <DoneCard
          stepId="rerank"
          stepView={view}
          summary={rerank?.summary}
          completedAt={rerank?.completed_at}
          onContinue={() => onNavigate?.('insights')}
          onRunAgain={() => { setResult(null); setRerunning(true); }}
        />
      ) : (
        <>
          <div className={stepBody}>
            {statusNotice && (
              <p role="alert" className="m-0 rounded-xl bg-error-container text-on-error-container px-4 py-3 font-medium">{t('pipeline.statusError')}</p>
            )}

            {result?.error && !loading && (
              <div role="alert" className={errorBox}>
                <Icon name="error" className="text-[22px] shrink-0" />
                <div className="min-w-0">
                  <p className="m-0 font-bold">{t(streamErrorKey(result.code) ?? 'rerank.failed')}</p>
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer">{t('action.details')}</summary>
                    <p className="mt-1 break-words">{result.error}</p>
                  </details>
                </div>
              </div>
            )}

            {loading && <ProgressPanel stage={currentStage} progress={progress} logs={logs} download={download ?? undefined} />}

            {!loading && DONE_CARD_STATES.has(view.state) && (
              <button
                type="button"
                onClick={() => { setResult(null); setRerunning(false); }}
                className={`${secondaryButton} self-start`}
              >
                <Icon name="arrow_back" className="text-[18px]" />
                {t('action.viewResults')}
              </button>
            )}

            {!loading && (
              <div className={noteBox}>
                <Icon name="info" className="text-[20px] text-primary shrink-0" />
                <p className="m-0">{t('rerank.hint')}</p>
              </div>
            )}

            {skipError && (
              <div role="alert" className="rounded-xl bg-error-container text-on-error-container px-4 py-3 text-sm">
                <p className="m-0 font-semibold">{t('rerank.skipFailed')}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer">{t('action.details')}</summary>
                  <p className="mt-1 break-words">{skipError}</p>
                </details>
              </div>
            )}
          </div>

          {!loading && (
            <div className={stepFooter}>
              {showSkip ? (
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={!view.canStart || skipping}
                  className={linkButton}
                >
                  {t('action.skip')}
                </button>
              ) : <span />}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <GateReason stepId="rerank" onNavigate={onNavigate} />
                <button
                  type="button"
                  onClick={handleRerank}
                  disabled={!view.canStart || loading}
                  className={primaryButton}
                >
                  <Icon name="fact_check" className="text-[18px]" />
                  {t('rerank.start')}
                </button>
              </div>
            </div>
          )}

          {!loading && (
            <details className={advancedDetails}>
              <summary className={advancedSummary}>
                <Icon name="tune" className="text-[18px]" />
                {t('action.advanced')}
              </summary>
              <div className={advancedBody}>
                <label className="flex flex-col gap-1.5 max-w-md">
                  <span className={fieldLabel}>{t('rerank.max.title')}</span>
                  <input
                    value={maxDocuments}
                    inputMode="numeric"
                    onChange={(e) => setMaxDocuments(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder={t('rerank.max.placeholder')}
                    className={textInput}
                  />
                </label>
                <label className="flex flex-col gap-1.5 max-w-md">
                  <span className={fieldLabel}>{t('rerank.model')}</span>
                  <input
                    value={rerankerModel}
                    onChange={(e) => setRerankerModel(e.target.value)}
                    className={`${textInput} font-mono`}
                  />
                  {status?.theme_reranker_model && (
                    <span className="text-xs text-on-surface-variant break-words">{status.theme_reranker_model}</span>
                  )}
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowModelDownload}
                    onChange={(e) => setAllowModelDownload(e.target.checked)}
                    className={checkbox}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold text-on-surface">{t('vec.download.title')}</span>
                    <span className="text-on-surface-variant">{t('rerank.download.lead')}</span>
                  </span>
                </label>
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}
