import { useState, useEffect, useRef } from 'react';
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
import { PIPELINE_STEPS } from '../config/pipelineSteps';
import { DEFAULT_TIER, isTier, modelFor } from '../config/modelTiers';
import TierPicker from './pipeline/TierPicker';
import AdvancedModelSelect from './pipeline/AdvancedModelSelect';
import StepHeader from './pipeline/StepHeader';
import useModelTiers from './pipeline/useModelTiers';
import {
  advancedBody, advancedDetails, advancedSummary, checkbox, errorBox, insetCard,
  primaryButton, secondaryButton, stepBody, stepFooter,
} from './pipeline/stepStyles';
import { shortTier } from '../utils/doneMessage';
import { downloadFromEvent, streamErrorKey } from '../utils/downloadProgress';

const STEP_N = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.id, s.n]));

export default function VectorDBBuilder({ onNavigate }) {
  const { t, formatNumber } = useI18n();
  const stream = useNdjsonStream();
  const { status, refresh } = usePipelineStatus();
  const view = deriveStepView(status, 'vectors');
  const anonymizedAt = status?.steps?.anonymize?.completed_at;
  const vectors = status?.steps?.vectors;
  const [loading, setLoading] = useState(false);
  // True while the user sets up a new build (or reads its error) instead of the Done card.
  const [rerunning, setRerunning] = useState(false);
  // A build succeeded but the status that shows it could not be loaded.
  const [statusNotice, setStatusNotice] = useState(false);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentDoc, setCurrentDoc] = useState('');
  const [download, setDownload] = useState(null);

  // Configuration state
  const [columns, setColumns] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);
  // Tier cards pick the model; an Advanced id (advancedModel) wins over the tier.
  const [tier, setTier] = useState(DEFAULT_TIER);
  const [advancedModel, setAdvancedModel] = useState(null);
  const tiers = useModelTiers('vectors');
  const tierTouched = useRef(false);
  const selectedModel = modelFor('vectors', tier, advancedModel);
  // An existing build's tier is pre-selected until the user chooses one.
  const builtTier = vectors?.summary?.tier;
  useEffect(() => {
    if (!tierTouched.current && isTier(builtTier)) setTier(builtTier);
  }, [builtTier]);
  const [allowModelDownload, setAllowModelDownload] = useState(true);
  const [rowCount, setRowCount] = useState(0);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState(null);
  const [vectorCheckpoint, setVectorCheckpoint] = useState(null);

  // Load columns and checkpoint status on mount, and again when step 1 produced a new file
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
          setConfigError(null);
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
  }, [anonymizedAt]);

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
    // The picked tier names the download; an Advanced or resumed model uses the event's tier.
    const downloadTier = overrideModel || advancedModel ? null : tier;

    setLoading(true);
    setRerunning(true);
    setStatusNotice(false);
    setProgress(0);
    setCurrentStage('');
    setLogs([]);
    setCurrentDoc('');
    setDownload(null);
    setResult(null);
    setVectorCheckpoint(null);

    let sawEvent = false;
    let succeeded = false;
    try {
      // Start from the current status; the backend refuses (409) anyway when step 1 is not done.
      await refresh();
      await stream.start('/api/build-vectors', {
        embedding_model: model,
        selected_columns: cols,
        allow_model_download: allowModelDownload
      }, {
        onEvent: (data) => {
          if (!sawEvent) {
            sawEvent = true;
            refresh();
          }
          if (data.status === 'progress') {
            setDownload(downloadFromEvent(data, downloadTier));
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.stage) setCurrentStage(data.stage);
            if (data.message) setLogs(prev => [...prev, data.message]);
            if (data.current_doc) setCurrentDoc(data.current_doc);
          } else if (data.status === 'success') {
            setDownload(null);
            setProgress(100);
            setCurrentStage('save');
            succeeded = true;
          } else if (data.status === 'error') {
            setDownload(null);
            const key = streamErrorKey(data.code);
            setResult({ error: data.error, ...(key ? { message: t(key) } : {}) });
            if (data.error) setLogs(prev => [...prev, data.error]);
          }
        }
      });
    } catch (error) {
      if (error?.code === 'error.blocked') {
        const step = error.params?.step ?? 'anonymize';
        setResult({ error: error.message, message: t('error.blocked', { n: STEP_N[step] ?? 1, name: t('step.' + step) }) });
      } else {
        setResult({ error: error.message });
        setLogs(prev => [...prev, error.message]);
      }
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

  const modelName = advancedModel || shortTier(t('tier.' + tier));
  const showDone = DONE_CARD_STATES.has(view.state) && !loading && !rerunning;

  const chip = 'bg-surface-container-low px-3 py-1.5 rounded-full';

  return (
    <>
      <StepHeader stepId="vectors" />

      {showDone ? (
        <DoneCard
          stepId="vectors"
          stepView={view}
          summary={vectors?.summary}
          completedAt={vectors?.completed_at}
          onContinue={() => onNavigate?.('rerank')}
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
                  <p className="m-0 font-bold">{result.message ?? t('state.error')}</p>
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer">{t('action.details')}</summary>
                    <p className="mt-1 break-words">{result.error}</p>
                  </details>
                </div>
              </div>
            )}

            {loading && (
              <>
                <div className="flex flex-wrap gap-2 text-sm text-on-surface-variant">
                  <span className={chip}>{t('vec.rows', { n: formatNumber(rowCount) })}</span>
                  <span className={chip}>{t('vec.columns.chosen', { x: selectedColumns.length, y: columns.length })}</span>
                  <span className={chip}>{t('common.model')}: {modelName}</span>
                </div>
                <ProgressPanel stage={currentStage} progress={progress} logs={currentDoc ? [...logs, currentDoc] : logs} download={download ?? undefined} />
              </>
            )}

            {!loading && (
              <>
                {DONE_CARD_STATES.has(view.state) && (
                  <button
                    type="button"
                    onClick={() => { setResult(null); setRerunning(false); }}
                    className={`${secondaryButton} self-start`}
                  >
                    <Icon name="arrow_back" className="text-[18px]" />
                    {t('action.viewResults')}
                  </button>
                )}

                {vectorCheckpoint && (
                  <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-warning/30 bg-warning-container p-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon name="schedule" className="text-[20px] text-warning shrink-0" />
                      <div className="min-w-0">
                        <p className="m-0 font-bold text-warning">{t('vec.checkpoint.title', { x: formatNumber(vectorCheckpoint.processed_count), y: formatNumber(vectorCheckpoint.total_docs) })}</p>
                        <p className="m-0 mt-1 text-sm text-on-surface">{t('anon.interrupted.hint')}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setVectorCheckpoint(null)} className={secondaryButton}>
                        {t('anon.restart')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBuild(vectorCheckpoint.embedding_model, vectorCheckpoint.selected_columns)}
                        disabled={!view.canStart}
                        className={primaryButton}
                      >
                        {t('anon.resume')}
                      </button>
                    </div>
                  </div>
                )}

                {configError && (
                  <div className="flex items-start gap-3 rounded-xl bg-warning-container text-on-surface p-4 text-sm">
                    <Icon name="warning" className="text-[20px] text-warning shrink-0" />
                    <span>{configError === 'columns' ? t('vec.err.columns') : t('vec.err.connect')}</span>
                  </div>
                )}

                <fieldset className={`${insetCard} m-0 flex flex-col gap-3`}>
                  <legend className="sr-only">{t('vec.columns.title')}</legend>
                  <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-bold text-on-surface">
                      <Icon name="view_column" className="text-[20px] text-on-surface-variant" />
                      {t('vec.columns.title')}
                    </span>
                    {configLoaded && <span className="text-[13px] text-on-surface-variant">{t('vec.rows', { n: formatNumber(rowCount) })}</span>}
                  </div>
                  {configLoaded ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                      {columns.map((col) => {
                        const isSelected = selectedColumns.includes(col);
                        return (
                          <label
                            key={col}
                            className={`flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-xl border cursor-pointer min-w-0 ${isSelected ? 'border-primary bg-[#f5f9ff]' : 'border-outline-variant hover:bg-surface-container-low'}`}
                          >
                            <input type="checkbox" checked={isSelected} onChange={() => toggleColumn(col)} className={checkbox} />
                            <span className="text-sm font-medium text-on-surface truncate" title={col}>{col}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="m-0 py-6 text-center text-sm text-outline">
                      {configError ? t('vec.columns.unavailable') : t('vec.columns.loading')}
                    </p>
                  )}
                  <p className="m-0 text-[13px] text-on-surface-variant">{t('vec.columns.chosen', { x: selectedColumns.length, y: columns.length })}</p>
                </fieldset>

                <TierPicker
                  step="vectors"
                  value={tier}
                  tiers={tiers}
                  showAdvanced={false}
                  advancedModelId={advancedModel}
                  onChange={(next) => { tierTouched.current = true; setTier(next); setAdvancedModel(null); }}
                  onAdvancedChange={(id) => { tierTouched.current = true; setAdvancedModel(id); }}
                  disabled={loading}
                />
              </>
            )}
          </div>

          {!loading && (
            <div className={stepFooter}>
              <span className="text-sm text-on-surface-variant">
                {t('vec.summary', { r: formatNumber(rowCount), model: modelName })}
              </span>
              <div className="flex flex-wrap items-center justify-end gap-3 max-sm:w-full">
                <GateReason stepId="vectors" onNavigate={onNavigate} />
                <button
                  type="button"
                  onClick={() => handleBuild()}
                  disabled={loading || selectedColumns.length === 0 || !view.canStart}
                  className={`${primaryButton} max-sm:w-full min-h-[48px] text-[15px]`}
                >
                  {t('step.vectors')}
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
                <AdvancedModelSelect
                  step="vectors"
                  tier={tier}
                  tiers={tiers}
                  advancedModelId={advancedModel}
                  onAdvancedChange={(id) => { tierTouched.current = true; setAdvancedModel(id); }}
                />
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowModelDownload}
                    onChange={(e) => setAllowModelDownload(e.target.checked)}
                    className={checkbox}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold text-on-surface">{t('vec.download.title')}</span>
                    <span className="text-on-surface-variant">{t('vec.download.lead')}</span>
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
