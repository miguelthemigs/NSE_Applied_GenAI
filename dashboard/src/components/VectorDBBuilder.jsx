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

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100 transition-all duration-500">
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-100">
        <div className="p-3 bg-gradient-to-tr from-fuchsia-500 to-rose-500 text-white rounded-xl shadow-lg">
          <Icon name="database" className="text-2xl" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('step.vectors')}</h2>
          <p className="text-gray-500 text-sm mt-1">{t('step.vectors.lead')}</p>
        </div>
      </div>

      {showDone && (
        <DoneCard
          stepId="vectors"
          stepView={view}
          summary={vectors?.summary}
          completedAt={vectors?.completed_at}
          onContinue={() => onNavigate?.('rerank')}
          onRunAgain={() => { setResult(null); setRerunning(true); }}
        />
      )}

      {statusNotice && !showDone && (
        <p role="alert" className="m-0 rounded-xl bg-error-container text-on-error-container px-4 py-3 font-medium">{t('pipeline.statusError')}</p>
      )}

      {/* --- ERROR --- */}
      {result?.error && !loading && !showDone && (
        <div role="alert" className="p-5 rounded-2xl bg-error-container text-on-error-container flex items-start gap-3">
          <Icon name="error" className="text-2xl shrink-0" />
          <div className="min-w-0">
            <p className="m-0 font-bold">{result.message ?? t('state.error')}</p>
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer">{t('action.details')}</summary>
              <p className="mt-1 break-words">{result.error}</p>
            </details>
          </div>
        </div>
      )}

      {/* --- CONFIGURATION PANEL --- */}
      {!loading && !showDone && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">

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

          {vectorCheckpoint && (
            <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 rounded-xl shrink-0">
                    <Icon name="schedule" className="text-xl text-amber-600" />
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
                    disabled={!view.canStart}
                    className="px-5 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-amber-600 transition-all disabled:opacity-50"
                  >
                    {t('anon.resume')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {configError && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex items-start gap-3">
              <Icon name="warning" className="text-xl mt-0.5 shrink-0" />
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
                          {isSelected && <Icon name="check" className="text-xs text-white" />}
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
            <div className="p-6 bg-white border border-gray-100 shadow-sm rounded-2xl md:col-span-2">
              <TierPicker
                step="vectors"
                value={tier}
                advancedModelId={advancedModel}
                onChange={(next) => { tierTouched.current = true; setTier(next); setAdvancedModel(null); }}
                onAdvancedChange={(id) => { tierTouched.current = true; setAdvancedModel(id); }}
                disabled={loading}
              />
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
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="text-sm text-gray-600">
              {t('vec.summary', { r: formatNumber(rowCount), model: modelName })}
            </div>
            <GateReason stepId="vectors" onNavigate={onNavigate} className="ml-auto" />
            <button
              onClick={() => handleBuild()}
              disabled={loading || selectedColumns.length === 0 || !view.canStart}
              className="px-8 py-3 bg-gradient-to-r from-fuchsia-600 to-rose-600 text-white rounded-xl font-bold shadow-lg shadow-fuchsia-200 disabled:opacity-50 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
            >
              {t('step.vectors')}
            </button>
          </div>
        </div>
      )}

      {/* --- BUILDING PROGRESS --- */}
      {loading && (
        <ProgressPanel stage={currentStage} progress={progress} logs={currentDoc ? [...logs, currentDoc] : logs} download={download ?? undefined} />
      )}

    </div>
  );
}
