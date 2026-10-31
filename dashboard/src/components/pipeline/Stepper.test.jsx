import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { I18nProvider } from '../../i18n/I18nProvider.jsx'
import Stepper from './Stepper.jsx'
import fresh from '../../../e2e/fixtures/status/fresh.json'
import allDone from '../../../e2e/fixtures/status/all-done.json'
import anonNeedsReview from '../../../e2e/fixtures/status/anon-needs-review.json'
import vectorsRunning from '../../../e2e/fixtures/status/vectors-running.json'

function renderStepper(props) {
  const onSelect = vi.fn()
  render(
    <I18nProvider>
      <Stepper status={fresh} current="anonymize" onSelect={onSelect} {...props} />
    </I18nProvider>,
  )
  return { onSelect }
}

beforeEach(() => localStorage.clear())

describe('Stepper', () => {
  it('renders a tablist with 5 tabs and marks the current one selected', () => {
    renderStepper({ status: allDone, current: 'rerank' })
    const list = screen.getByRole('tablist', { name: 'Stappen' })
    const tabs = within(list).getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false'])
    expect(tabs[2]).toHaveAttribute('tabindex', '0')
    expect(tabs[0]).toHaveAttribute('tabindex', '-1')
  })

  it('done steps have an accessible name with the done state (not colour only)', () => {
    renderStepper({ status: allDone, current: 'query' })
    expect(screen.getByRole('tab', { name: /Persoonsgegevens verwijderen.*Klaar/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Stel een vraag.*Klaar voor gebruik/ })).toBeInTheDocument()
  })

  it('fresh install: step 1 is the next step, steps 2 to 5 say which step comes first', () => {
    renderStepper()
    expect(screen.getByRole('tab', { name: /Persoonsgegevens verwijderen.*Volgende stap/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Antwoorden doorzoekbaar maken.*Eerst stap 1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Thema's controleren.*Eerst stap 2 · optioneel/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Samenvattingen schrijven.*Eerst stap 2/ })).toBeInTheDocument()
  })

  it('shows the review count of step 1', () => {
    renderStepper({ status: anonNeedsReview })
    expect(screen.getByRole('tab', { name: /Persoonsgegevens verwijderen.*1 om na te kijken/ })).toBeInTheDocument()
  })

  it('shows the running percentage', () => {
    renderStepper({ status: vectorsRunning, current: 'vectors' })
    expect(screen.getByRole('tab', { name: /Antwoorden doorzoekbaar maken.*Bezig… 42%/ })).toBeInTheDocument()
  })

  it('a running step without progress yet reads as working', () => {
    renderStepper({ status: { ...vectorsRunning, active_job: { step: 'vectors', stage: null, progress: null } }, current: 'vectors' })
    const tab = screen.getByRole('tab', { name: /Antwoorden doorzoekbaar maken/ })
    expect(tab).toHaveAccessibleName(/Bezig…$/)
  })

  it('ArrowRight and ArrowLeft move focus between tabs; Home and End jump', async () => {
    renderStepper({ status: allDone, current: 'anonymize' })
    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(tabs[4]).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(tabs[0]).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(tabs[4]).toHaveFocus()
  })

  it('clicking a tab selects that step, also a blocked one (soft gating)', async () => {
    const { onSelect } = renderStepper()
    await userEvent.click(screen.getByRole('tab', { name: /Samenvattingen schrijven/ }))
    expect(onSelect).toHaveBeenCalledWith('insights')
  })

  it('has a collapsed control for small screens with the position and the step name', () => {
    renderStepper({ status: vectorsRunning, current: 'vectors' })
    const toggle = screen.getByRole('button', { name: /Stap 2 van 5/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Antwoorden doorzoekbaar maken')
  })

  it('the collapsed control names the current state and expands a vertical step list', async () => {
    renderStepper({ status: vectorsRunning, current: 'vectors' })
    const toggle = screen.getByRole('button', { name: /^Stap 2 van 5\s·\sAntwoorden doorzoekbaar maken\s·\sBezig… 42%$/ })
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tablist')).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('picking a step from the expanded list collapses it and returns focus to the toggle', async () => {
    const { onSelect } = renderStepper({ status: vectorsRunning, current: 'vectors' })
    const toggle = screen.getByRole('button', { name: /Stap 2 van 5/ })
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('tab', { name: /Persoonsgegevens verwijderen/ }))
    expect(onSelect).toHaveBeenCalledWith('anonymize')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('while the first status loads no tab is selected, but the first one stays reachable by Tab', () => {
    renderStepper({ status: null, current: null })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(0)
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })
})
