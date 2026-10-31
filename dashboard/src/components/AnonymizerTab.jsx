import { useState, useEffect } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl, getJson } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';
import GateReason from './pipeline/GateReason';
import ProgressPanel from './pipeline/ProgressPanel';
import DoneCard from './pipeline/DoneCard';
import { usePipelineStatus } from '../context/PipelineStatusContext';
import { deriveStepView, isMet } from '../utils/stepView';
import { continueHintKey, DONE_CARD_STATES } from '../utils/doneMessage';

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
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-error-container text-on-error-container px-3 py-2 text-sm">
        <span className="grow font-medium">{t('done.review.loadFailed')}</span>
        <button type="button" onClick={onRetry} className="min-h-[44px] px-3 py-2 rounded-xl bg-surface-container-lowest text-primary font-semibold border border-outline-variant hover:bg-surface-container-low">
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
          <li key={k} className="bg-surface-container-lowest rounded-xl px-3.5 py-3 flex flex-col gap-1.5">
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
    <details className="border border-outline-variant rounded-xl">
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
      setResult({ error: err.message });
    } finally {
      await finishRun(succeeded);
    }
  };

  const MASKING_INFO = [
    { tag: '[NAME]',     key: 'NAME',     bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', color: 'indigo' },
    { tag: '[LOCATION]', key: 'LOCATION', bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-200',   color: 'blue' },
    { tag: '[PII]',      key: 'PII',      bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', color: 'purple' },
    { tag: '[TITLE]',    key: 'TITLE',    bg: 'bg-rose-100',   text: 'text-rose-700',   border: 'border-rose-200',   color: 'rose' },
    { tag: '[HEALTH]',   key: 'HEALTH',   bg: 'bg-emerald-100',text: 'text-emerald-700',border: 'border-emerald-200', color: 'emerald' },
  ];

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
      setResult({ error: error.message });
      setProgress(0);
    } finally {
      await finishRun(succeeded);
    }
  };

  // view.state (not the raw state) so no Done card shows while step 1 runs.
  const showDone = DONE_CARD_STATES.has(view.state) && !loading && !rerunning;

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-3 sm:p-6 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100 transition-all duration-500">
      <div className="flex items-center space-x-4 pb-4 border-b border-gray-100">
        <div className="p-3 bg-gradient-to-tr from-indigo-500 to-purple-500 text-white rounded-xl shadow-lg">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl break-words font-extrabold tracking-tight text-gray-900">{t('step.anonymize')}</h2>
          <p className="text-gray-500 text-sm mt-1">{t('step.anonymize.lead')}</p>
        </div>
      </div>

      {statusNotice && !showDone && (
        <p role="alert" className="m-0 rounded-xl bg-error-container text-on-error-container px-4 py-3 font-medium">{t('pipeline.statusError')}</p>
      )}

      {showDone ? (
        <DoneCard
          stepId="anonymize"
          stepView={view}
          summary={anon?.summary}
          completedAt={anon?.completed_at}
          onContinue={() => onNavigate?.('vectors')}
          onRunAgain={runAgain}
          onRunCheck={runCheck}
          listReady={listState === 'ready'}
          details={<RemovedDetails report={currentReport} />}
        >
          <MissedList report={currentReport} review={anon?.summary?.review} listState={listState} onRetry={retryReport} />
        </DoneCard>
      ) : (
      <div className="relative">
        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-8 relative z-10">
          <div className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-1 bg-gray-100 rounded-full -z-10"></div>
          <div className={`absolute top-1/2 -translate-y-1/2 left-0 h-1 bg-indigo-500 rounded-full -z-10 transition-all duration-700 ease-out`} style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}></div>

          {[1, 2, 3].map(s => (
            <div key={s} className={`flex items-center justify-center w-10 h-10 rounded-full font-bold transition-all duration-500 shadow-md ${step >= s ? 'bg-indigo-600 text-white scale-110' : 'bg-white text-gray-400 border-2 border-gray-200'}`}>
              {step > s ? <Icon name="check" /> : s}
            </div>
          ))}
        </div>

        {/* --- STEP 1 --- */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {checkpoint && (
              <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-amber-100 rounded-xl shrink-0">
                      <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" /></svg>
                    </div>
                    <div>
                      <p className="font-bold text-amber-900">{t('anon.interrupted.title')}</p>
                      <p className="text-sm text-amber-700 mt-1">
                        <span className="font-semibold">
                          {checkpoint.current_col
                            ? t('anon.interrupted.progress', { x: checkpoint.completed_columns.length, y: checkpoint.total_columns.length, col: checkpoint.current_col })
                            : t('anon.interrupted.progressNoCol', { x: checkpoint.completed_columns.length, y: checkpoint.total_columns.length })}
                        </span>
                      </p>
                      <p className="text-xs text-amber-600 mt-1">{t('anon.interrupted.hint')}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setCheckpoint(null)}
                      className="px-3 py-2 bg-white text-amber-700 text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all ring-1 ring-amber-300"
                    >
                      {t('anon.restart')}
                    </button>
                    <button
                      onClick={() => handleAnonymize(checkpoint.total_columns, checkpoint.selected_layers, runVerification)}
                      disabled={!view.canStart}
                      className="px-5 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-amber-600 transition-all disabled:opacity-50"
                    >
                      {t('anon.resume')}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {lastReport && existingAnonymized && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-xl shrink-0">
                    <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700 text-sm">{t('anon.previous.title')}</p>
                    <p className="text-xs text-slate-500">{t('anon.previous.meta', { date: formatTimestamp(lastReport.timestamp), n: formatNumber(lastReport.rows_processed ?? 0), m: formatNumber(lastReport.total_entities ?? 0) })}</p>
                  </div>
                </div>
                <button
                  onClick={showResults}
                  className="px-4 py-2 bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-800 transition-all shrink-0"
                >
                  {t('anon.previous.view')}
                </button>
              </div>
            )}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-purple-400 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
              <div className="relative border-2 border-dashed border-indigo-200 bg-white/50 p-12 rounded-2xl text-center hover:border-indigo-500 cursor-pointer transition-all duration-300">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  disabled={loading}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none">
                  <div className="p-4 bg-indigo-50 text-indigo-500 rounded-full group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-gray-800">{t('anon.drop.title')}</p>
                    <p className="text-sm text-gray-500">{t('anon.drop.hint')}</p>
                  </div>
                  {file && <p className="mt-4 inline-flex items-center text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full ring-1 ring-emerald-200"><Icon name="check" className="mr-1" />{file.name}</p>}
                </div>
              </div>
            </div>

            {existingAnonymized && (
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-3 text-indigo-800">
                    <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    <span className="text-sm font-medium">{t('anon.existing')}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <GateReason stepId="anonymize" onNavigate={onNavigate} />
                    <button
                      onClick={runCheck}
                      disabled={loading || !view.canStart}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-indigo-700 transition-all disabled:opacity-50"
                    >
                      {loading ? t('anon.check.running') : t('anon.check.run')}
                    </button>
                    {/* Same gate as the Done card: not while step 1 needs review or is unverified. */}
                    <button
                      onClick={() => { if (typeof onNavigate === 'function') onNavigate('vectors'); }}
                      disabled={!isMet(anonState)}
                      aria-describedby={continueHint ? 'anon-existing-hint' : undefined}
                      className="px-4 py-2 bg-white text-indigo-600 text-sm font-bold rounded-lg shadow-sm hover:shadow-md transition-all ring-1 ring-indigo-200 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:hover:bg-white"
                    >
                      {t('action.continue', { n: 2 })}
                    </button>
                  </div>
                </div>
                {continueHint && (
                  <p id="anon-existing-hint" className="m-0 text-sm font-medium text-warning">{t(continueHint)}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* --- STEP 2 --- */}
        {step === 2 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
            <div className="p-5 bg-indigo-50 border border-indigo-100 rounded-xl">
              <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-3">{t('anon.removes.title')}</p>
              <div className="flex flex-wrap gap-2">
                {MASKING_INFO.map((item) => (
                  <div
                    key={item.tag}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${item.border} ${item.bg} shadow-sm`}
                  >
                    <span className={`font-mono text-xs font-black ${item.text}`}>{item.tag}</span>
                    <span className="text-xs text-gray-600">{t('anon.mask.' + item.key)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-indigo-700 mt-3">
                {t('anon.removes.note')}
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Columns Section */}
              <div className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl">
                <div className="flex items-center space-x-2 pb-2 border-b border-gray-50">
                  <Icon name="view_column" className="text-xl text-gray-500" />
                  <h3 className="font-bold text-gray-800">{t('anon.columns.title')}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
                  {columns.map(col => {
                    const isSelected = selectedColumns.includes(col);
                    return (
                      <label
                        key={col}
                        className={`flex items-center p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ${isSelected ? 'border-indigo-500 bg-indigo-50/50' : 'border-gray-100 hover:border-gray-200 bg-white'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleColumn(col)}
                          className="sr-only"
                        />
                        <div className={`flex items-center justify-center w-5 h-5 rounded flex-shrink-0 mr-3 transition-colors ${isSelected ? 'bg-indigo-500' : 'border border-gray-300'}`}>
                          {isSelected && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </div>
                        <span className={`text-sm truncate font-medium ${isSelected ? 'text-indigo-900' : 'text-gray-600'}`} title={col}>{col}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Layers Section (Advanced) */}
              <details className="space-y-4 p-6 bg-white border border-gray-100 shadow-sm rounded-2xl self-start">
                <summary className="flex items-center gap-2 cursor-pointer font-bold text-gray-800">
                  <Icon name="tune" className="text-xl text-gray-500" />
                  {t('action.advanced')}
                </summary>
                <fieldset className="space-y-3 pt-4">
                  <legend className="font-bold text-gray-800 text-sm">{t('anon.layers.title')}</legend>
                  {LAYER_PRESETS.map((preset) => {
                    const active = preset.layers.length === selectedLayers.length
                      && preset.layers.every((layer) => selectedLayers.includes(layer));
                    return (
                      <label
                        key={preset.id}
                        className={`block w-full p-3 rounded-xl border cursor-pointer text-left transition-all focus-within:ring-2 focus-within:ring-primary/40 ${active ? 'border-primary bg-primary/5 shadow-sm' : 'border-gray-100 bg-gray-50 hover:border-gray-300 hover:bg-white'}`}
                      >
                        <input
                          type="radio"
                          name="anon-preset"
                          value={preset.id}
                          checked={active}
                          onChange={() => setSelectedLayers(preset.layers)}
                          className="sr-only"
                        />
                        <span className={`block text-sm font-bold ${active ? 'text-primary' : 'text-gray-700'}`}>{t('anon.preset.' + preset.id)}</span>
                        <span className="block text-xs leading-snug text-gray-500 mt-0.5">{t('anon.preset.' + preset.id + '.lead')}</span>
                      </label>
                    );
                  })}
                </fieldset>

                <fieldset className="space-y-2 pt-4">
                  <legend className="font-bold text-gray-800 text-sm">{t('anon.checks.title')}</legend>
                  {LAYER_OPTIONS.map((id) => (
                    <label key={id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedLayers.includes(id)}
                        onChange={() => toggleLayer(id)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-gray-700 font-mono">{id}</span>
                        <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{t('anon.layer.' + id)}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </details>
            </div>

            {/* Custom Word Blocklist */}
            <div className="p-6 bg-white border border-gray-100 shadow-sm rounded-2xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-gray-50">
                <div className="flex items-center space-x-2">
                  <Icon name="block" className="text-xl text-gray-500" />
                  <h3 className="font-bold text-gray-800">{t('anon.blocklist.title')}</h3>
                </div>
                {blocklist.length > 0 && (
                  <span className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-100 px-2 py-1 rounded-full">
                    {t('anon.blocklist.count', { n: blocklist.length })}
                  </span>
                )}
              </div>

              <p className="text-xs text-gray-500 leading-relaxed">
                {t('anon.blocklist.lead')}
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={blocklistInput}
                  onChange={e => setBlocklistInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addBlocklistWord()}
                  placeholder={t('anon.blocklist.placeholder')}
                  className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 transition-all"
                />
                <button
                  type="button"
                  onClick={addBlocklistWord}
                  disabled={!blocklistInput.trim()}
                  className="px-4 py-2 bg-purple-600 text-white text-sm font-bold rounded-xl hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {t('anon.blocklist.add')}
                </button>
              </div>

              {blocklist.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {blocklist.map(word => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 text-purple-800 text-sm font-mono rounded-lg"
                    >
                      {word}
                      <button
                        type="button"
                        onClick={() => removeBlocklistWord(word)}
                        className="text-purple-400 hover:text-purple-700 transition-colors leading-none"
                        title={t('anon.blocklist.remove', { word })}
                        aria-label={t('anon.blocklist.remove', { word })}
                      >
                        <Icon name="close" className="text-base" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">{t('anon.blocklist.empty')}</p>
              )}
            </div>

            {preview.length > 0 && (
              <div className="p-5 bg-gray-50 border border-gray-200 rounded-xl">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{t('anon.preview.title')}</p>
                <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                  {selectedColumns.slice(0, 4).map(col => (
                    <div key={col} className="min-w-[200px] max-w-[250px] p-3 bg-white rounded-lg shadow-sm border border-gray-100 flex-shrink-0">
                      <p className="text-xs font-bold text-indigo-600 mb-1 truncate">{col}</p>
                      <p className="text-sm text-gray-700 line-clamp-3">{String(preview[0][col] || '')}</p>
                    </div>
                  ))}
                  {selectedColumns.length > 4 && (
                    <div className="min-w-[100px] flex items-center justify-center text-sm font-medium text-gray-400">
                      {t('anon.preview.more', { n: selectedColumns.length - 4 })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <GateReason stepId="anonymize" onNavigate={onNavigate} className="block text-right" />
            <div className="flex gap-4 pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 bg-white text-gray-700 font-bold rounded-xl hover:bg-gray-50 border border-gray-200 transition-colors"
              >
                {t('anon.back')}
              </button>

              <button
                type="button"
                onClick={() => setRunVerification(prev => !prev)}
                className={`px-5 py-3 rounded-xl font-bold border transition-all text-sm flex items-center gap-2 ${runVerification ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                title={t('anon.verify.title')}
              >
                <Icon name="fact_check" />
                {runVerification ? t('anon.verify.on') : t('anon.verify.off')}
              </button>

              <button
                onClick={() => handleAnonymize()}
                disabled={loading || selectedColumns.length === 0 || selectedLayers.length === 0 || !view.canStart}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 disabled:opacity-50 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {t('anon.start.busy')}
                  </span>
                ) : t('anon.start')}
              </button>
            </div>
          </div>
        )}

        {/* --- STEP 3 --- */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">

            {loading && (
              <div className="space-y-3">
                <ProgressPanel stage={currentStage} progress={progress} logs={logs} />
                {currentPreview && (
                  <div className="p-4 bg-surface-container-low rounded-xl">
                    <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">{t('anon.live')}</p>
                    <p className="text-sm font-mono leading-relaxed line-clamp-2 text-on-surface-variant">{currentPreview}</p>
                  </div>
                )}
                {lastCheckpointRow && progress < 100 && (
                  <div className="flex items-center gap-2 text-sm text-success bg-success-container rounded-xl px-3 py-2">
                    <Icon name="check_circle" className="text-[18px]" />
                    {t('anon.checkpointSaved')}
                  </div>
                )}
              </div>
            )}

            {result?.error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-start gap-3">
                <svg className="w-5 h-5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                <div>
                  <p className="font-bold">{t('anon.failed')}</p>
                  {result.errorKey ? (
                    <p className="text-sm mt-1">{t(result.errorKey)}</p>
                  ) : (
                    <details className="text-sm mt-1">
                      <summary className="cursor-pointer">{t('action.details')}</summary>
                      <p className="mt-1">{result.error}</p>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => { setResult(null); setStep(1); }}
                      className="px-4 py-2 bg-white text-red-700 text-sm font-bold rounded-lg ring-1 ring-red-200 hover:bg-red-50"
                    >
                      {t('anon.back')}
                    </button>
                    {existingAnonymized && (
                      <button
                        type="button"
                        onClick={showResults}
                        className="px-4 py-2 bg-white text-red-700 text-sm font-bold rounded-lg ring-1 ring-red-200 hover:bg-red-50"
                      >
                        {t('anon.previous.view')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
