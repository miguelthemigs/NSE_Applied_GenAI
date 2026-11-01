import { useState, useEffect } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl, getJson } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';
import GateReason from './pipeline/GateReason';
import ProgressPanel from './pipeline/ProgressPanel';
import DoneCard from './pipeline/DoneCard';
import StepHeader from './pipeline/StepHeader';
import {
  advancedBody, advancedDetails, advancedSummary, checkbox, errorBox, insetCard, primaryButton,
  secondaryButton, stepBody, stepFooter, textInput,
} from './pipeline/stepStyles';
import { usePipelineStatus } from '../context/PipelineStatusContext';
import { deriveStepView, isMet } from '../utils/stepView';
import { continueHintKey, DONE_CARD_STATES } from '../utils/doneMessage';
import { gateErrorMessage } from '../utils/gateError';

// Step 1 states in which an anonymised file exists on disk.
const HAS_OUTPUT = new Set(['done', 'needs_review', 'unverified', 'stale']);
const MASK_KEYS = ['NAME', 'LOCATION', 'PII', 'TITLE', 'HEALTH'];

/**
 * The possibly-missed text of the current report, shown inside the Done card's
 * review box. Never collapsed: the user must see it before acknowledging.
 * listState: 'loading' | 'failed' | 'ready' (the report matching the status).
 */
function MissedList({ report, review, listState, onRetry }) {
  const { t, formatNumber } = useI18n();
  if (!(Number(review) > 0)) return null;
  if (listState === 'loading') {
    return (
      <p className="m-0 flex items-center gap-2 text-sm text-on-surface-variant">
        <Icon name="progress_activity" className="text-[18px] motion-safe:animate-spin" />
        {t('common.loading')}
      </p>
    );
  }
  if (listState !== 'ready') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] bg-error-container text-on-error-container px-3 py-2 text-sm">
        <span className="grow font-medium">{t('done.review.loadFailed')}</span>
        <button type="button" onClick={onRetry} className="min-h-[44px] px-3 py-2 rounded-[10px] bg-surface-container-lowest text-primary font-semibold border border-outline-variant hover:bg-surface-container-low">
          {t('action.retry')}
        </button>
      </div>
    );
  }
  const keys = MASK_KEYS.filter((k) => (report?.missed_counts?.[k] ?? 0) > 0);
  if (keys.length === 0) return <p className="m-0 text-sm text-on-surface-variant">{t('anon.samples.none')}</p>;
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2">
      {keys.map((k) => {
        const samples = report.missed_samples?.[k] ?? [];
        return (
          <li key={k} className="bg-surface-container-lowest rounded-[10px] px-3.5 py-3 flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-on-surface-variant">
              {t('anon.mask.' + k)} · {t('anon.count.missed', { n: formatNumber(report.missed_counts[k]) })}
            </span>
            {samples.length > 0 ? (
              <span className="flex flex-wrap gap-2">
                {samples.map((sample, i) => (
                  <mark key={i} className="px-1.5 py-0.5 rounded-lg bg-warning-container text-on-surface text-sm font-mono break-all">{sample}</mark>
                ))}
              </span>
            ) : (
              <span className="text-sm text-on-surface-variant">{t('anon.samples.none')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What was removed, per kind of personal detail (collapsed). */
function RemovedDetails({ report }) {
  const { t, formatNumber } = useI18n();
  const keys = MASK_KEYS.filter((k) => (report?.tag_counts?.[k] ?? 0) > 0);
  if (keys.length === 0) return null;
  return (
    <details className="border border-outline-variant rounded-[12px]">
      <summary className="px-4 py-3.5 font-semibold text-primary cursor-pointer">{t('done.removed.title')}</summary>
      <ul className="m-0 px-4 pb-4 list-none flex flex-col gap-3">
        {keys.map((k) => {
          const samples = report.removed_samples?.[k] ?? [];
          return (
            <li key={k} className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-on-surface">
                {t('anon.mask.' + k)} · {t('anon.count.removed', { n: formatNumber(report.tag_counts[k]) })}
              </span>
              {samples.length > 0 && (
                <span className="flex flex-wrap gap-2">
                  {samples.map((sample, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-lg bg-surface-container-low text-on-surface-variant text-sm font-mono break-all">{sample}</span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const PHASES = ['upload', 'columns', 'review'];

/** Upload — Choose columns — Check results, with the current part marked. */
function Phases({ current }) {
  const { t } = useI18n();
  return (
    <ol aria-label={t('anon.phase.label')} className="m-0 p-0 list-none flex flex-wrap items-center gap-2 text-sm">
      {PHASES.map((phase, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return (
          <li key={phase} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            {i > 0 && <span aria-hidden="true" className="max-sm:hidden text-outline-variant">—</span>}
            <span className={`flex items-center gap-1.5 ${state === 'done' ? 'text-primary font-semibold' : state === 'current' ? 'text-on-surface font-bold' : 'text-outline'}`}>
              {state === 'done' ? (
                <Icon name="check" className="text-[18px]" />
              ) : (
                <span aria-hidden="true" className={`w-[18px] h-[18px] rounded-full border-2 box-border flex items-center justify-center ${state === 'current' ? 'border-primary' : 'border-outline-variant'}`}>
                  {state === 'current' && <span className="w-2 h-2 rounded-full bg-primary" />}
                </span>
              )}
              {t('anon.phase.' + phase)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function AnonymizerTab({ onNavigate }) {
  const { t, formatNumber, formatDate } = useI18n();
  const stream = useNdjsonStream();
  const { status, refresh } = usePipelineStatus();
  const view = deriveStepView(status, 'anonymize');
  const anon = status?.steps?.anonymize;
  const anonState = anon?.state;
  const reportId = anon?.summary?.report_id ?? null;
  const existingAnonymized = HAS_OUTPUT.has(anonState);
  const continueHint = continueHintKey(anonState);
  const [file, setFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [selectedLayers, setSelectedLayers] = useState(['presidio', 'eu-pii']);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState([]);
  const [progress, setProgress] = useState(0);
  const [runVerification, setRunVerification] = useState(true);
  // True while the user is setting up a new run (or looking at its error)
  // instead of the Done card of the current output.
  const [rerunning, setRerunning] = useState(false);
  // A run succeeded but the status that shows it could not be loaded.
  const [statusNotice, setStatusNotice] = useState(false);
  const [blocklist, setBlocklist] = useState([]);
  const [blocklistInput, setBlocklistInput] = useState('');

  // Real-time stream states
  const [currentStage, setCurrentStage] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentPreview, setCurrentPreview] = useState('');
  const [lastCheckpointRow, setLastCheckpointRow] = useState(null);
  const [checkpoint, setCheckpoint] = useState(null);

  useEffect(() => {
    fetch(apiUrl('/api/checkpoint-status'))
      .then(r => r.json())
      .then(data => { if (data.has_checkpoint) setCheckpoint(data); })
      .catch(() => {});
    fetch(apiUrl('/api/word-blocklist'))
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.words)) setBlocklist(data.words); })
      .catch(() => {});
  }, []);

  // The report behind the Done card (missed / removed text). Fetched again
  // whenever the status names a different report (or on retry), so the list
  // the user acknowledges is always the one the backend records the tick for.
  const [reportAttempt, setReportAttempt] = useState(0);
  const reportKey = `${reportId}#${reportAttempt}`;
  const [reportResult, setReportResult] = useState({ key: null, report: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    const settle = (report, failed) => { if (!cancelled) setReportResult({ key: reportKey, report, failed }); };
    getJson('/api/anonymize-report')
      .then(({ ok, data }) => {
        if (ok && data?.has_report === true) settle(data, false);
        else settle(null, true);
      })
      .catch(() => settle(null, true));
    return () => { cancelled = true; };
  }, [reportKey]);
  const lastReport = reportResult.report;
  const reportMatches = Boolean(lastReport) && (lastReport.timestamp == null || !reportId || lastReport.timestamp === reportId);
  const listState = reportResult.key !== reportKey ? 'loading' : reportMatches ? 'ready' : 'failed';
  const currentReport = listState === 'ready' ? lastReport : null;
  const retryReport = () => {
    refresh();
    setReportAttempt((n) => n + 1);
  };

  const saveBlocklist = (updatedWords) => {
    fetch(apiUrl('/api/word-blocklist'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: updatedWords }),
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.words)) setBlocklist(data.words); })
      .catch(() => {});
  };

  const addBlocklistWord = () => {
    const word = blocklistInput.trim();
    if (!word || blocklist.map(w => w.toLowerCase()).includes(word.toLowerCase())) {
      setBlocklistInput('');
      return;
    }
    const updated = [...blocklist, word];
    setBlocklist(updated);
    setBlocklistInput('');
    saveBlocklist(updated);
  };

  const removeBlocklistWord = (word) => {
    const updated = blocklist.filter(w => w !== word);
    setBlocklist(updated);
    saveBlocklist(updated);
  };

  // Back to the Done card of the current output.
  const showResults = () => {
    setResult(null);
    setRerunning(false);
  };

  const runAgain = () => {
    setResult(null);
    setStep(1);
    setRerunning(true);
  };

  // Keeps the progress panel up until the refreshed status shows the new
  // result, so the step never goes blank in between; says so if it can't load.
  const finishRun = async (succeeded) => {
    const refreshed = await refresh();
    setLoading(false);
    if (succeeded) {
      setRerunning(false);
      if (!refreshed?.status) setStatusNotice(true);
    }
  };

  // Re-runs the follow-up check on the existing anonymised file.
  const runCheck = async () => {
    setLoading(true);
    setStatusNotice(false);
    setRerunning(true);
    setStep(3);
    setResult(null);
    setProgress(0);
    setCurrentStage('');
    setLogs([]);
    let sawEvent = false;
    let succeeded = false;
    try {
      await stream.start('/api/run-anonymize-check', undefined, {
        onEvent: (data) => {
          if (!sawEvent) {
            sawEvent = true;
            refresh();
          }
          if (data.status === 'progress') {
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.stage) setCurrentStage(data.stage);
          } else if (data.status === 'success') {
            setProgress(100);
            succeeded = true;
          } else if (data.status === 'error') {
            setResult({ error: data.error });
          }
        }
      });
    } catch (err) {
      setResult({ error: err.message, message: gateErrorMessage(t, err) });
    } finally {
      await finishRun(succeeded);
    }
  };

  const MASKING_INFO = MASK_KEYS.map((key) => ({ tag: `[${key}]`, key }));

  const LAYER_PRESETS = [
    { id: 'fast', layers: ['presidio'] },
    { id: 'recommended', layers: ['presidio', 'eu-pii'] },
    { id: 'deep', layers: ['presidio', 'eu-pii', 'openai-privacy-filter'] },
  ];

  // Technical layer ids are shown as-is, under Advanced only.
  const LAYER_OPTIONS = ['presidio', 'eu-pii', 'openai-privacy-filter'];

  const toggleLayer = (id) => {
    setSelectedLayers((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  };

  const formatTimestamp = (ts) => {
    try { return formatDate(ts); } catch { return String(ts ?? ''); }
  };

  const isQuestionnaireColumn = (col) => {
    const name = String(col).trim();
    const lower = name.toLowerCase();
    return (
      name.includes('?') ||
      lower.startsWith('wil jij') ||
      lower.startsWith('waarom') ||
      lower.startsWith('wat voor soort')
    );
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);

      const response = await fetch(apiUrl('/api/inspect-file'), {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.status === 'success') {
        setColumns(data.columns);
        setPreview(data.preview);
        setStep(2);
        const questionnaireColumns = data.columns.filter(isQuestionnaireColumn);
        setSelectedColumns(questionnaireColumns);
      } else {
        setResult({ error: data.error });
      }
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const toggleColumn = (col) => {
    setSelectedColumns(prev =>
      prev.includes(col)
        ? prev.filter(c => c !== col)
        : [...prev, col]
    );
  };

  const handleAnonymize = async (overrideColumns = null, overrideLayers = null, overrideVerification = null) => {
    const cols = overrideColumns ?? selectedColumns;
    const lyrs = overrideLayers ?? selectedLayers;
    const verify = overrideVerification ?? runVerification;

    if (cols.length === 0) {
      setResult({ errorKey: 'anon.err.columns' });
      return;
    }

    if (lyrs.length === 0) {
      setResult({ errorKey: 'anon.err.layers' });
      return;
    }

    setLoading(true);
    setStatusNotice(false);
    setRerunning(true);
    setStep(3);
    setResult(null);
    setProgress(0);
    setCurrentStage('');
    setLogs([]);
    setCurrentPreview('');
    setCheckpoint(null);

    let sawEvent = false;
    let succeeded = false;
    try {
      await stream.start('/api/anonymize', {
        selected_columns: cols,
        selected_layers: lyrs,
        run_verification: verify
      }, {
        onEvent: (data) => {
          if (!sawEvent) {
            sawEvent = true;
            refresh();
          }
          if (data.status === 'progress') {
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.stage) setCurrentStage(data.stage);
            if (data.message) setLogs(prev => [...prev, data.message]);
            if (data.preview) setCurrentPreview(data.preview);
            if (data.checkpoint_saved && data.row) setLastCheckpointRow(`${data.column} (${data.row}/${data.total_rows})`);
          } else if (data.status === 'success') {
            setProgress(100);
            succeeded = true;
          } else if (data.status === 'error') {
            setResult({ error: data.error });
          }
        }
      });
    } catch (error) {
      setResult({ error: error.message, message: gateErrorMessage(t, error) });
      setProgress(0);
    } finally {
      await finishRun(succeeded);
    }
  };

  // view.state (not the raw state) so no Done card shows while step 1 runs.
  const showDone = DONE_CARD_STATES.has(view.state) && !loading && !rerunning;

  // Thoroughness and the word filter. Shown under the Done card and while setting up a run.
  const advanced = (
    <details className={advancedDetails}>
      <summary className={advancedSummary}>
        <Icon name="tune" className="text-[18px]" />
        {t('anon.advanced')}
      </summary>
      <div className={advancedBody}>
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
          <legend className="p-0 mb-2 font-semibold text-on-surface">{t('anon.layers.title')}</legend>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {LAYER_PRESETS.map((preset) => {
              const active = preset.layers.length === selectedLayers.length
                && preset.layers.every((layer) => selectedLayers.includes(layer));
              return (
                <label
                  key={preset.id}
                  className={`flex flex-col gap-1 rounded-[12px] cursor-pointer min-w-0 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${active ? 'border-2 border-primary bg-primary-tint p-[11px]' : 'border border-outline-variant bg-surface-container-lowest p-3 hover:bg-surface-container-low'}`}
                >
                  <input
                    type="radio"
                    name="anon-preset"
                    value={preset.id}
                    checked={active}
                    onChange={() => setSelectedLayers(preset.layers)}
                    className="sr-only"
                  />
                  <span className={`text-sm font-bold ${active ? 'text-primary' : 'text-on-surface'}`}>{t('anon.preset.' + preset.id)}</span>
                  <span className="text-[13px] leading-snug text-on-surface-variant">{t('anon.preset.' + preset.id + '.lead')}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
          <legend className="p-0 mb-2 font-semibold text-on-surface">{t('anon.checks.title')}</legend>
          {LAYER_OPTIONS.map((id) => (
            <label key={id} className="flex items-start gap-3 p-3 rounded-[12px] border border-outline-variant bg-surface-container-lowest cursor-pointer">
              <input
                type="checkbox"
                checked={selectedLayers.includes(id)}
                onChange={() => toggleLayer(id)}
                className={checkbox}
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-on-surface font-mono break-all">{id}</span>
                <span className="block text-[13px] text-on-surface-variant mt-0.5 leading-snug">{t('anon.layer.' + id)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-3 pt-4 border-t border-surface-container-highest">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-on-surface">
              <Icon name="block" className="text-[20px] text-on-surface-variant" />
              {t('anon.blocklist.title')}
            </h3>
            {blocklist.length > 0 && (
              <span className="text-xs font-semibold text-primary bg-primary-fixed px-2.5 py-1 rounded-full">
                {t('anon.blocklist.count', { n: blocklist.length })}
              </span>
            )}
          </div>
          <p className="m-0 text-sm text-on-surface-variant">{t('anon.blocklist.lead')}</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={blocklistInput}
              onChange={(e) => setBlocklistInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addBlocklistWord()}
              placeholder={t('anon.blocklist.placeholder')}
              aria-label={t('anon.blocklist.title')}
              className={`${textInput} flex-[1_1_200px] w-auto`}
            />
            <button
              type="button"
              onClick={addBlocklistWord}
              disabled={!blocklistInput.trim()}
              className={secondaryButton}
            >
              <Icon name="add" className="text-[18px]" />
              {t('anon.blocklist.add')}
            </button>
          </div>
          {blocklist.length > 0 ? (
            <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
              {blocklist.map((word) => (
                <li key={word} className="inline-flex items-center gap-1 pl-3 pr-1 py-1 bg-primary-fixed text-primary text-sm font-mono rounded-[12px] break-all">
                  {word}
                  <button
                    type="button"
                    onClick={() => removeBlocklistWord(word)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-primary/10"
                    title={t('anon.blocklist.remove', { word })}
                    aria-label={t('anon.blocklist.remove', { word })}
                  >
                    <Icon name="close" className="text-[16px]" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-outline">{t('anon.blocklist.empty')}</p>
          )}
        </div>
      </div>
    </details>
  );

  return (
    <>
      <StepHeader stepId="anonymize" />

      {showDone ? (
        <>
          <DoneCard
            stepId="anonymize"
            stepView={view}
            summary={anon?.summary}
            completedAt={anon?.completed_at}
            onContinue={() => onNavigate?.('vectors')}
            onRunAgain={runAgain}
            onRunCheck={runCheck}
            listReady={listState === 'ready'}
            intro={<Phases current={3} />}
            details={<RemovedDetails report={currentReport} />}
          >
            <MissedList report={currentReport} review={anon?.summary?.review} listState={listState} onRetry={retryReport} />
          </DoneCard>
          {advanced}
        </>
      ) : (
        <>
          <div className={stepBody}>
            {statusNotice && (
              <p role="alert" className="m-0 rounded-[12px] bg-error-container text-on-error-container px-4 py-3 font-medium">{t('pipeline.statusError')}</p>
            )}

            <Phases current={step} />

            {/* --- STEP 1 --- */}
            {step === 1 && (
              <>
                {checkpoint && (
                  <div className="flex flex-wrap items-start justify-between gap-4 rounded-[12px] border border-warning/30 bg-warning-container p-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon name="schedule" className="text-[20px] text-warning shrink-0" />
                      <div className="min-w-0">
                        <p className="m-0 font-bold text-warning">{t('anon.interrupted.title')}</p>
                        <p className="m-0 mt-1 text-sm font-semibold text-on-surface">
                          {checkpoint.current_col
                            ? t('anon.interrupted.progress', { x: checkpoint.completed_columns.length, y: checkpoint.total_columns.length, col: checkpoint.current_col })
                            : t('anon.interrupted.progressNoCol', { x: checkpoint.completed_columns.length, y: checkpoint.total_columns.length })}
                        </p>
                        <p className="m-0 mt-1 text-sm text-on-surface">{t('anon.interrupted.hint')}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setCheckpoint(null)} className={secondaryButton}>
                        {t('anon.restart')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAnonymize(checkpoint.total_columns, checkpoint.selected_layers, runVerification)}
                        disabled={!view.canStart}
                        className={primaryButton}
                      >
                        {t('anon.resume')}
                      </button>
                    </div>
                  </div>
                )}

                {lastReport && existingAnonymized && (
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] bg-surface-container-low p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-[12px] bg-surface-container-lowest text-primary flex items-center justify-center shrink-0">
                        <Icon name="description" className="text-[20px]" />
                      </span>
                      <div className="min-w-0">
                        <p className="m-0 font-semibold text-sm text-on-surface">{t('anon.previous.title')}</p>
                        <p className="m-0 text-[13px] text-on-surface-variant">{t('anon.previous.meta', { date: formatTimestamp(lastReport.timestamp), n: formatNumber(lastReport.rows_processed ?? 0), m: formatNumber(lastReport.total_entities ?? 0) })}</p>
                      </div>
                    </div>
                    <button type="button" onClick={showResults} className={secondaryButton}>
                      {t('anon.previous.view')}
                    </button>
                  </div>
                )}

                <div className="relative border-2 border-dashed border-outline-variant bg-surface-container-low rounded-[12px] px-4 py-10 sm:p-12 text-center hover:border-primary has-[:focus-visible]:border-primary transition-colors duration-150">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileUpload}
                    disabled={loading}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center justify-center gap-3 pointer-events-none">
                    <span className="w-14 h-14 rounded-2xl bg-primary-fixed text-primary flex items-center justify-center">
                      <Icon name="cloud_upload" className="text-[28px]" />
                    </span>
                    <div className="flex flex-col gap-1">
                      <p className="m-0 text-base font-semibold text-on-surface">{t('anon.drop.title')}</p>
                      <p className="m-0 text-sm text-on-surface-variant">{t('anon.drop.hint')}</p>
                    </div>
                    {file && (
                      <p className="m-0 mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary bg-surface-container-lowest border border-outline-variant px-3 py-1 rounded-full max-w-full break-all">
                        <Icon name="check" className="text-[18px] shrink-0" />{file.name}
                      </p>
                    )}
                  </div>
                </div>

                {existingAnonymized && (
                  <div className="flex flex-col gap-3 rounded-[12px] border border-outline-variant p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 text-on-surface">
                        <Icon name="check_circle" className="text-[20px] text-primary shrink-0" />
                        <span className="text-sm font-medium">{t('anon.existing')}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <GateReason stepId="anonymize" onNavigate={onNavigate} />
                        <button
                          type="button"
                          onClick={runCheck}
                          disabled={loading || !view.canStart}
                          className={secondaryButton}
                        >
                          <Icon name="fact_check" className="text-[18px]" />
                          {loading ? t('anon.check.running') : t('anon.check.run')}
                        </button>
                        {/* Same gate as the Done card: not while step 1 needs review or is unverified. */}
                        <button
                          type="button"
                          onClick={() => { if (typeof onNavigate === 'function') onNavigate('vectors'); }}
                          disabled={!isMet(anonState)}
                          aria-describedby={continueHint ? 'anon-existing-hint' : undefined}
                          className={primaryButton}
                        >
                          {t('action.continue', { n: 2 })}
                          <Icon name="arrow_forward" className="text-[18px]" />
                        </button>
                      </div>
                    </div>
                    {continueHint && (
                      <p id="anon-existing-hint" className="m-0 text-sm font-medium text-warning">{t(continueHint)}</p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* --- STEP 2 --- */}
            {step === 2 && (
              <>
                <div className="flex flex-col gap-3 rounded-[12px] bg-surface-container-low p-4">
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-on-surface-variant">{t('anon.removes.title')}</p>
                  <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
                    {MASKING_INFO.map((item) => (
                      <li key={item.tag} className="flex items-center gap-2 px-3 py-2 rounded-[12px] bg-surface-container-lowest border border-outline-variant">
                        <span className="font-mono text-xs font-extrabold text-primary">{item.tag}</span>
                        <span className="text-xs text-on-surface-variant">{t('anon.mask.' + item.key)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-[13px] text-on-surface-variant">{t('anon.removes.note')}</p>
                </div>

                <fieldset className={`${insetCard} m-0 flex flex-col gap-3`}>
                  <legend className="sr-only">{t('anon.columns.title')}</legend>
                  <span aria-hidden="true" className="flex items-center gap-2 font-bold text-on-surface">
                    <Icon name="view_column" className="text-[20px] text-on-surface-variant" />
                    {t('anon.columns.title')}
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {columns.map((col) => {
                      const isSelected = selectedColumns.includes(col);
                      return (
                        <label
                          key={col}
                          className={`flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-[12px] border cursor-pointer min-w-0 ${isSelected ? 'border-primary bg-primary-tint' : 'border-outline-variant hover:bg-surface-container-low'}`}
                        >
                          <input type="checkbox" checked={isSelected} onChange={() => toggleColumn(col)} className={checkbox} />
                          <span className="text-sm font-medium text-on-surface truncate" title={col}>{col}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {preview.length > 0 && (
                  <div className="flex flex-col gap-3 rounded-[12px] bg-surface-container-low p-4 min-w-0">
                    <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-on-surface-variant">{t('anon.preview.title')}</p>
                    <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                      {selectedColumns.slice(0, 4).map((col) => (
                        <div key={col} className="min-w-[200px] max-w-[250px] p-3 bg-surface-container-lowest rounded-[12px] border border-outline-variant shrink-0">
                          <p className="m-0 mb-1 text-xs font-bold text-primary truncate">{col}</p>
                          <p className="m-0 text-sm text-on-surface line-clamp-3">{String(preview[0][col] || '')}</p>
                        </div>
                      ))}
                      {selectedColumns.length > 4 && (
                        <div className="min-w-[100px] flex items-center justify-center text-sm font-medium text-outline">
                          {t('anon.preview.more', { n: selectedColumns.length - 4 })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* --- STEP 3 --- */}
            {step === 3 && loading && (
              <div className="flex flex-col gap-3">
                <ProgressPanel stage={currentStage} progress={progress} logs={logs} />
                <p className="m-0 text-sm text-on-surface-variant">{t('progress.browseNote')}</p>
                {currentPreview && (
                  <div className="p-4 bg-surface-container-low rounded-[12px]">
                    <p className="m-0 mb-1 text-xs font-bold uppercase tracking-[0.06em] text-on-surface-variant">{t('anon.live')}</p>
                    <p className="m-0 text-sm font-mono leading-relaxed line-clamp-2 text-on-surface-variant">{currentPreview}</p>
                  </div>
                )}
                {lastCheckpointRow && progress < 100 && (
                  <div className="flex items-center gap-2 text-sm text-success bg-success-container rounded-[12px] px-3 py-2">
                    <Icon name="check_circle" className="text-[18px]" />
                    {t('anon.checkpointSaved')}
                  </div>
                )}
              </div>
            )}

            {step === 3 && result?.error && (
              <div role="alert" className={errorBox}>
                <Icon name="error" className="text-[22px] shrink-0" />
                <div className="min-w-0">
                  <p className="m-0 font-bold">{t('anon.failed')}</p>
                  {result.message && <p className="m-0 mt-1 text-sm">{result.message}</p>}
                  {result.errorKey ? (
                    <p className="m-0 mt-1 text-sm">{t(result.errorKey)}</p>
                  ) : (
                    <details className="mt-1 text-sm">
                      <summary className="cursor-pointer">{t('action.details')}</summary>
                      <p className="mt-1 break-words">{result.error}</p>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" onClick={() => { setResult(null); setStep(1); }} className={secondaryButton}>
                      {t('anon.back')}
                    </button>
                    {existingAnonymized && (
                      <button type="button" onClick={showResults} className={secondaryButton}>
                        {t('anon.previous.view')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {step === 2 && (
            <div className={stepFooter}>
              <button type="button" onClick={() => setStep(1)} className={secondaryButton}>
                <Icon name="arrow_back" className="text-[18px]" />
                {t('anon.back')}
              </button>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <GateReason stepId="anonymize" onNavigate={onNavigate} />
                <button
                  type="button"
                  onClick={() => setRunVerification((prev) => !prev)}
                  aria-pressed={runVerification}
                  className={`${secondaryButton} ${runVerification ? 'bg-primary-fixed border-primary' : ''}`}
                  title={t('anon.verify.title')}
                >
                  <Icon name="fact_check" className="text-[18px]" />
                  {runVerification ? t('anon.verify.on') : t('anon.verify.off')}
                </button>
                <button
                  type="button"
                  onClick={() => handleAnonymize()}
                  disabled={loading || selectedColumns.length === 0 || selectedLayers.length === 0 || !view.canStart}
                  className={primaryButton}
                >
                  {loading ? (
                    <>
                      <Icon name="progress_activity" className="text-[18px] motion-safe:animate-spin" />
                      {t('anon.start.busy')}
                    </>
                  ) : (
                    <>
                      <Icon name="shield_person" className="text-[18px]" />
                      {t('anon.start')}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {(step === 1 || step === 2) && !loading && advanced}
        </>
      )}
    </>
  );
}
