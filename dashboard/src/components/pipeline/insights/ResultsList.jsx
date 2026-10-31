import { useEffect, useState } from 'react'
import { usePipelineStatus } from '../../../context/PipelineStatusContext'
import { useI18n } from '../../../i18n/I18nProvider'
import { getJson } from '../../../services/api'

const PILL = {
  done: 'bg-success-container text-success',
  partial: 'bg-primary-fixed text-primary',
  in_progress: 'bg-primary-fixed text-primary',
  not_started: 'bg-surface-container-low text-on-surface-variant',
  off: 'bg-surface-container-lowest text-outline border border-dashed border-outline-variant',
}
const ORDER = ['main', 'sub', 'filtered']

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const progressState = (done, total) => (total > 0 && done >= total ? 'done' : done > 0 ? 'partial' : 'not_started')

/** Rows from the pipeline status, for when GET /api/insights/results is unavailable. */
function rowsFromSummary(summary, filtered) {
  const done = num(summary?.themes_done)
  const total = num(summary?.themes_total)
  const sub = num(summary?.subthemes_done)
  return [
    { kind: 'main', done, total, state: progressState(done, total) },
    { kind: 'sub', done: sub, total: null, state: sub > 0 ? 'done' : 'not_started' },
    { kind: 'filtered', done: null, total: null, state: filtered ? 'not_started' : 'off' },
  ]
}

/**
 * The three result rows of step 4: main themes, sub-themes and per year /
 * location / programme. Counts come from GET /api/insights/results; the
 * filtered row is "Off" whenever no filter dimensions are chosen.
 * reloadKey refetches (e.g. after a run or after clearing the cache).
 */
export default function ResultsList({ filterDimensions = [], reloadKey = 0 }) {
  const { t, formatNumber } = useI18n()
  const { status } = usePipelineStatus()
  const filtered = filterDimensions.length > 0
  const dimsKey = filterDimensions.join(',')
  const lastUpdated = status?.last_updated
  const activeStep = status?.active_job?.step ?? null
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    const query = dimsKey ? `?filter_dimensions=${encodeURIComponent(dimsKey)}` : ''
    getJson(`/api/insights/results${query}`)
      .then(({ ok, data }) => {
        if (!cancelled) setRows(ok && Array.isArray(data?.rows) ? data.rows : null)
      })
      .catch(() => { if (!cancelled) setRows(null) })
    return () => { cancelled = true }
  }, [dimsKey, reloadKey, lastUpdated, activeStep])

  // A row the backend did not send falls back to the pipeline status.
  const byKind = Object.fromEntries(
    [...rowsFromSummary(status?.steps?.insights?.summary, filtered), ...(rows ?? [])].map((r) => [r.kind, r]),
  )

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="m-0 text-base font-bold text-on-surface">{t('insights.results')}</h3>
      <ul className="m-0 p-0 list-none border border-outline-variant rounded-[12px] overflow-hidden">
        {ORDER.map((kind) => {
          const row = byKind[kind]
          const off = kind === 'filtered' && (!filtered || row.state === 'off')
          const state = off ? 'off' : PILL[row.state] ? row.state : 'not_started'
          const hasTotal = row.total !== null && row.total !== undefined
          const shown = hasTotal ? Math.min(num(row.done), num(row.total)) : num(row.done)
          let count = '—'
          if (!off && row.done !== null && row.done !== undefined) {
            count = hasTotal ? `${formatNumber(shown)} / ${formatNumber(num(row.total))}` : formatNumber(shown)
          }
          const label = state === 'in_progress' ? t('state.working') : t('state.' + state, { x: formatNumber(shown), y: formatNumber(num(row.total)) })
          return (
            <li key={kind} className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-surface-container-highest last:border-b-0">
              <span className={`flex-[1_1_220px] font-semibold ${off ? 'text-on-surface-variant' : 'text-on-surface'}`}>{t('insights.row.' + kind)}</span>
              <span className={`min-w-[60px] tabular-nums ${off ? 'text-outline' : 'text-on-surface-variant'}`}>{count}</span>
              <span className={`text-[13px] font-semibold px-3 py-1 rounded-full ${PILL[state]}`}>{label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
