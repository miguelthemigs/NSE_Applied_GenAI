import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '../../i18n/I18nProvider.jsx'
import ProgressPanel from './ProgressPanel.jsx'
import StageProgress from './StageProgress.jsx'
import { etaFrom } from './useEta.js'

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

beforeEach(() => localStorage.clear())

describe('ProgressPanel', () => {
  it('renders the translated stage and the percentage in a polite status line', () => {
    wrap(<ProgressPanel stage="process" progress={42} logs={[]} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Verwerken')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('treats the download stage as model loading', () => {
    wrap(<ProgressPanel stage="download" progress={10} logs={[]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Model laden')
  })

  it('hides the logs until "Details tonen" is opened', async () => {
    wrap(<ProgressPanel stage="read" progress={5} logs={['row 1 of 300', 'row 2 of 300']} />)
    const summary = screen.getByText('Details tonen')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText(/row 1 of 300/)).not.toBeVisible()
    await userEvent.click(summary)
    expect(details).toHaveAttribute('open')
    expect(screen.getByText(/row 1 of 300/)).toBeVisible()
  })

  it('shows the download line with formatted GB, and no invented ETA', () => {
    wrap(<ProgressPanel stage="load" progress={10} logs={[]} download={{ bytesDone: 0.4e9, bytesTotal: 1.2e9, tierKey: 'balanced' }} />)
    expect(screen.getByText('Het Gebalanceerd-model wordt gedownload: 0,4 GB van 1,2 GB')).toBeInTheDocument()
    expect(screen.queryByText(/nog ongeveer/)).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33')
  })

  it('uses an explicit download ETA when given', () => {
    wrap(<ProgressPanel stage="load" progress={10} logs={[]} download={{ bytesDone: 0.4e9, bytesTotal: 1.2e9, tierKey: 'quick', etaSeconds: 100 }} />)
    expect(screen.getByText(/nog ongeveer 2 min/)).toBeInTheDocument()
  })

  it('shows the unknown-size copy when bytesTotal is null', () => {
    wrap(<ProgressPanel stage="load" progress={10} logs={[]} download={{ bytesDone: 5e8, bytesTotal: null, tierKey: 'balanced' }} />)
    expect(screen.getByText('Het Gebalanceerd-model wordt gedownload… Dit gebeurt maar één keer.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('names no tier for a model outside the tiers (reranker, Advanced id)', () => {
    const { rerender } = wrap(<ProgressPanel stage="load" progress={10} logs={[]} download={{ bytesDone: 0.4e9, bytesTotal: 1.2e9, tierKey: null }} />)
    expect(screen.getByText('Het model wordt gedownload: 0,4 GB van 1,2 GB')).toBeInTheDocument()
    rerender(<I18nProvider><ProgressPanel stage="load" progress={10} logs={[]} download={{ bytesDone: 5e8, bytesTotal: null, tierKey: null }} /></I18nProvider>)
    expect(screen.getByText('Het model wordt gedownload… Dit gebeurt maar één keer.')).toBeInTheDocument()
  })

  it('keeps a kind per log line and makes error lines stand out', () => {
    wrap(<ProgressPanel stage="process" progress={5} logs={['plain line', { kind: 'info', text: 'info line' }, { kind: 'error', text: 'Niet gelukt: boom' }]} />)
    expect(screen.getByText('plain line')).toHaveAttribute('data-kind', 'info')
    expect(screen.getByText('info line')).not.toHaveClass('text-error')
    const error = screen.getByText('Niet gelukt: boom')
    expect(error).toHaveAttribute('data-kind', 'error')
    expect(error).toHaveClass('text-error')
    expect(error.closest('details')).not.toBeNull()
  })

  it('shows an ETA only when one is supplied', () => {
    const { rerender } = wrap(<ProgressPanel stage="process" progress={40} logs={[]} />)
    expect(screen.queryByText(/nog ongeveer/)).not.toBeInTheDocument()
    rerender(<I18nProvider><ProgressPanel stage="process" progress={40} etaSeconds={150} logs={[]} /></I18nProvider>)
    expect(screen.getByText(/nog ongeveer 3 min/)).toBeInTheDocument()
  })
})

describe('StageProgress', () => {
  it('renders four labelled segments and marks the current one', () => {
    wrap(<StageProgress current="process" progress={50} />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual(['Model laden', 'Gegevens lezen', 'Verwerken', 'Opslaan'])
    expect(items.map((i) => i.getAttribute('aria-current'))).toEqual([null, null, 'step', null])
  })

  it('counts download as load', () => {
    wrap(<StageProgress current="download" progress={5} />)
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step')
  })
})

describe('etaFrom', () => {
  it('is null without enough signal and extrapolates otherwise', () => {
    const first = { progress: 10, at: 0 }
    expect(etaFrom(null, 10000, 50)).toBeNull()
    expect(etaFrom(first, 2000, 50)).toBeNull()
    expect(etaFrom(first, 10000, 12)).toBeNull()
    expect(etaFrom(first, 20000, 50)).toBeCloseTo(25)
    expect(etaFrom(first, 20000, 100)).toBeNull()
  })
})
