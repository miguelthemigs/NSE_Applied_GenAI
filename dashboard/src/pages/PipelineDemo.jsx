import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AnonymizerTab from '../components/AnonymizerTab';
import VectorDBBuilder from '../components/VectorDBBuilder';
import ThemeReranker from '../components/ThemeReranker';
import InsightGenerator from '../components/InsightGenerator';
import QueryTab from '../components/QueryTab';
import Stepper from '../components/pipeline/Stepper';
import WelcomeBackBanner from '../components/pipeline/WelcomeBackBanner';
import Icon from '../components/Icon';
import { useI18n } from '../i18n/I18nProvider';
import { PIPELINE_STEPS } from '../config/pipelineSteps';
import { PipelineStatusProvider, usePipelineStatus } from '../context/PipelineStatusContext';
import { firstOpenStep, stepPanelId, stepTabId } from '../utils/stepView';

const STEP_IDS = new Set(PIPELINE_STEPS.map((s) => s.id));
const PANELS = {
  anonymize: AnonymizerTab,
  vectors: VectorDBBuilder,
  rerank: ThemeReranker,
  insights: InsightGenerator,
  query: QueryTab,
};

function PipelineSteps() {
  const { t, formatDate } = useI18n();
  const { status, loading, error } = usePipelineStatus();
  const updated = formatDate(status?.last_updated);
  const [params, setParams] = useSearchParams();
  const urlStep = STEP_IDS.has(params.get('step')) ? params.get('step') : null;
  // Without ?step= the first open step is chosen once and written to the URL,
  // so a later status change never moves the user to another step on its own.
  const current = urlStep ?? (loading ? null : firstOpenStep(status));

  const selectStep = useCallback((id) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', id);
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    if (!urlStep && current) selectStep(current);
  }, [urlStep, current, selectStep]);

  // A panel mounts the first time it is opened and then stays mounted (hidden
  // when not selected), so a running stream survives a tab switch.
  const [visited, setVisited] = useState(() => new Set());
  if (current && !visited.has(current)) setVisited(new Set(visited).add(current));

  // "Welcome back" is about work saved before this visit, so it uses the
  // last_updated of the first status that loads, not of a run started now.
  const [firstLoad, setFirstLoad] = useState({ seen: false, lastUpdated: null });
  if (status && !firstLoad.seen) setFirstLoad({ seen: true, lastUpdated: status.last_updated ?? null });

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <main className="max-w-[1040px] mx-auto px-4 sm:px-6 pt-8 pb-16 flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5 max-w-[640px]">
            <h1 className="m-0 font-headline font-extrabold text-[26px] sm:text-[32px] leading-tight tracking-tight text-primary">{t('page.title')}</h1>
            <p className="m-0 text-on-surface-variant">{t('page.lead')}</p>
          </div>
          {updated && <p className="m-0 text-[13px] text-on-surface-variant">{t('done.updated', { date: updated })}</p>}
        </header>

        {firstLoad.lastUpdated && <WelcomeBackBanner lastUpdated={firstLoad.lastUpdated} />}

        {error && (
          <div role="status" className="flex items-center gap-3 rounded-xl bg-error-container text-on-error-container px-4 py-3">
            <Icon name="cloud_off" className="text-[20px] shrink-0" />
            <span className="font-medium">{error === 'offline' ? t('overview.offline') : t('pipeline.statusError')}</span>
          </div>
        )}

        <Stepper status={status} current={current} onSelect={selectStep} />

        {PIPELINE_STEPS.map((step) => {
          const Panel = PANELS[step.id];
          return (
            <section
              key={step.id}
              role="tabpanel"
              id={stepPanelId(step.id)}
              aria-labelledby={stepTabId(step.id)}
              hidden={step.id !== current}
              className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-3 sm:p-6 min-w-0"
            >
              {visited.has(step.id) && <Panel onNavigate={selectStep} />}
            </section>
          );
        })}
      </main>
    </div>
  );
}

export default function PipelineDemo() {
  return (
    <PipelineStatusProvider>
      <PipelineSteps />
    </PipelineStatusProvider>
  );
}
