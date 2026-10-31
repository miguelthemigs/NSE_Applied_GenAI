import { useState, useEffect } from 'react';
import { useNdjsonStream } from '../hooks/useNdjsonStream';
import { apiUrl } from '../services/api';
import { useI18n } from '../i18n/I18nProvider';
import Icon from './Icon';
import GateReason from './pipeline/GateReason';
import ProgressPanel from './pipeline/ProgressPanel';
import { usePipelineStatus } from '../context/PipelineStatusContext';
import { deriveStepView } from '../utils/stepView';

// Step 1 states in which an anonymised file exists on disk.
const HAS_OUTPUT = new Set(['done', 'needs_review', 'unverified', 'stale']);

export default function AnonymizerTab({ onNavigate }) {
  const { t, formatNumber, formatDate } = useI18n();
  const stream = useNdjsonStream();
  const { status, refresh } = usePipelineStatus();
  const view = deriveStepView(status, 'anonymize');
  const existingAnonymized = HAS_OUTPUT.has(status?.steps?.anonymize?.state);
  const [file, setFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [selectedLayers, setSelectedLayers] = useState(['presidio', 'eu-pii']);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState([]);
  const [progress, setProgress] = useState(0);
  const [showStats, setShowStats] = useState(true);
  const [runVerification, setRunVerification] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [blocklist, setBlocklist] = useState([]);
  const [blocklistInput, setBlocklistInput] = useState('');

  // Real-time stream states
  const [currentStage, setCurrentStage] = useState('');
  const [logs, setLogs] = useState([]);
  const [currentPreview, setCurrentPreview] = useState('');
  const [lastCheckpointRow, setLastCheckpointRow] = useState(null);
  const [checkpoint, setCheckpoint] = useState(null);
  const [lastReport, setLastReport] = useState(null);

  useEffect(() => {
    fetch(apiUrl('/api/checkpoint-status'))
      .then(r => r.json())
      .then(data => { if (data.has_checkpoint) setCheckpoint(data); })
      .catch(() => {});
    fetch(apiUrl('/api/anonymize-report'))
      .then(r => r.json())
      .then(data => { if (data.has_report) setLastReport(data); })
      .catch(() => {});
    fetch(apiUrl('/api/word-blocklist'))
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.words)) setBlocklist(data.words); })
      .catch(() => {});
  }, []);

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

  const loadLastReport = () => {
    if (!lastReport) return;
    setResult({
      rows_processed: lastReport.rows_processed,
      columns_anonymized: lastReport.columns,
      stats: {
        total_cells: lastReport.total_cells,
        affected_cells: lastReport.affected_cells,
        total_entities: lastReport.total_entities,
        tag_counts: lastReport.tag_counts,
        missed_counts: lastReport.missed_counts,
        missed_samples: lastReport.missed_samples,
        removed_samples: lastReport.removed_samples,
        verification_skipped: lastReport.verification_skipped,
      },
    });
    setShowStats(true);
    setStep(3);
  };

  const runCheck = async () => {
    setLoading(true);
    setResult(null);
    setProgress(0);
    setCurrentStage('');
    let sawEvent = false;
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
            setResult(data);
            setProgress(100);
            setLastReport({
              timestamp: new Date().toISOString(),
              rows_processed: data.rows_processed,
              total_entities: data.stats.total_entities,
              ...data.stats,
              columns: data.columns_anonymized,
            });
            setStep(3);
          } else if (data.status === 'error') {
            setResult({ error: data.error });
          }
        }
      });
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
      setShowStats(true);
      refresh();
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
    setStep(3);
    setResult(null);
    setProgress(0);
    setCurrentStage('');
    setLogs([]);
    setCurrentPreview('');
    setCheckpoint(null);

    let sawEvent = false;
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
            setResult(data);
            setProgress(100);
          } else if (data.status === 'error') {
            setResult({ error: data.error });
          }
        }
      });
    } catch (error) {
      setResult({ error: error.message });
      setProgress(0);
    } finally {
      setLoading(false);
      refresh();
    }
  };

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
            {lastReport && (
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
                  onClick={loadLastReport}
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
                    <button
                      onClick={() => { if (typeof onNavigate === 'function') onNavigate('vectors'); }}
                      className="px-4 py-2 bg-white text-indigo-600 text-sm font-bold rounded-lg shadow-sm hover:shadow-md transition-all ring-1 ring-indigo-200 hover:bg-indigo-50"
                    >
                      {t('action.continue', { n: 2 })}
                    </button>
                  </div>
                </div>
                {loading && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-indigo-700 font-medium">
                      <span>{currentStage ? t('stage.' + currentStage) : t('anon.check.starting')}</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full bg-indigo-100 rounded-full h-1.5">
                      <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
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
                </div>
              </div>
            )}

            {showStats && result?.stats && !result?.error && (
              <div className="p-6 bg-white border border-gray-100 rounded-2xl shadow-sm space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <Icon name="fact_check" className="text-xl text-gray-500" />
                    <h3 className="font-bold text-gray-800">{t('anon.results.title')}</h3>
                  </div>
                  {result.stats.verification_skipped
                    ? <span className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 px-3 py-1 rounded-full">{t('state.unverified')}</span>
                    : Object.values(result.stats.missed_counts ?? {}).every(v => v === 0)
                    ? <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">{t('anon.allClear')}</span>
                    : <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">{t('state.needs_review', { n: Object.values(result.stats.missed_counts ?? {}).reduce((a, v) => a + v, 0) })}</span>
                  }
                </div>

                <div className="space-y-3">
                  {MASKING_INFO.map(({ tag, key, color }) => {
                    const removed        = result.stats.tag_counts[key] ?? 0;
                    const missed         = result.stats.missed_counts?.[key] ?? 0;
                    const missedSamples  = result.stats.missed_samples?.[key] ?? [];
                    const removedSamples = result.stats.removed_samples?.[key] ?? [];
                    const verificationSkipped = Boolean(result.stats.verification_skipped);
                    const clean          = missed === 0;
                    const removedOpen    = expandedCategory === `${key}-removed`;
                    const missedOpen     = expandedCategory === `${key}-missed`;

                    return (
                      <div key={key} className={`rounded-xl border-2 overflow-hidden transition-colors ${
                        !clean        ? 'border-amber-200'
                        : removed > 0 ? `border-${color}-100`
                        :               'border-gray-100'
                      }`}>
                        {/* Main row */}
                        <div className={`w-full flex items-center justify-between p-4 ${
                          !clean        ? 'bg-amber-50/40'
                          : removed > 0 ? `bg-${color}-50/40`
                          :               'bg-gray-50'
                        }`}>
                          <div className="flex items-center gap-3">
                            <span className={`font-mono text-xs font-black px-2 py-1 rounded-md ${
                              !clean        ? 'bg-amber-100 text-amber-700'
                              : removed > 0 ? `bg-${color}-100 text-${color}-700`
                              :               'bg-gray-100 text-gray-400'
                            }`}>
                              {tag}
                            </span>
                            <span className={`text-sm font-medium ${removed > 0 || !clean ? 'text-gray-700' : 'text-gray-400'}`}>
                              {t('anon.mask.' + key)}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 text-sm">
                            {verificationSkipped ? (
                              <span className={`font-bold ${removed > 0 ? `text-${color}-700` : 'text-gray-400'}`}>
                                {t('anon.count.removed', { n: removed })}
                              </span>
                            ) : removed > 0 ? (
                              <button
                                type="button"
                                onClick={() => setExpandedCategory(removedOpen ? null : `${key}-removed`)}
                                className={`flex items-center gap-1.5 font-medium text-${color}-700 hover:underline cursor-pointer`}
                              >
                                {t('anon.count.removed', { n: removed })}
                                <svg className={`w-4 h-4 transition-transform ${removedOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            ) : null}
                            {!clean ? (
                              <button
                                type="button"
                                onClick={() => setExpandedCategory(missedOpen ? null : `${key}-missed`)}
                                className="flex items-center gap-1.5 font-bold text-amber-700 hover:underline cursor-pointer"
                              >
                                <Icon name="warning" className="text-amber-500" />
                                {t('anon.count.missed', { n: missed })}
                                <svg className={`w-4 h-4 text-amber-500 transition-transform ${missedOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            ) : removed > 0 ? (
                              <Icon name="check_circle" filled className="text-emerald-500" />
                            ) : (
                              <span className="text-xs text-gray-400 italic">{t('anon.none')}</span>
                            )}
                          </div>
                        </div>

                        {/* Removed samples panel */}
                        {!verificationSkipped && removedOpen && (
                          <div className={`border-t border-${color}-100 bg-white px-4 py-3 space-y-2`}>
                            <p className={`text-xs font-bold text-${color}-700 uppercase tracking-wider mb-2`}>
                              {t('anon.samples.removed', { n: removedSamples.length })}
                            </p>
                            {removedSamples.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {removedSamples.map((sample, i) => (
                                  <span key={i} className={`inline-block px-3 py-1 bg-${color}-50 border border-${color}-200 text-${color}-800 text-sm font-mono rounded-lg`}>
                                    {sample}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 italic">{t('anon.samples.none')}</p>
                            )}
                          </div>
                        )}

                        {/* Missed samples panel */}
                        {!verificationSkipped && missedOpen && (
                          <div className="border-t border-amber-200 bg-white px-4 py-3 space-y-2">
                            <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">
                              {t('anon.samples.missed', { n: missedSamples.length })}
                            </p>
                            {missedSamples.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {missedSamples.map((sample, i) => (
                                  <span key={i} className="inline-block px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-sm font-mono rounded-lg">
                                    {sample}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 italic">{t('anon.samples.none')}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm text-gray-500">
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {t(result.stats.verification_skipped ? 'anon.summary.skipped' : 'anon.summary', { cells: formatNumber(result.stats.total_cells ?? 0), n: formatNumber(result.stats.total_entities ?? 0) })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
