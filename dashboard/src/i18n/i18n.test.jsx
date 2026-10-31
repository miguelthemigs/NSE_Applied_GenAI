import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider, useI18n } from './I18nProvider.jsx'
import LanguageToggle from '../components/LanguageToggle.jsx'
import nl from './locales/nl.json'
import en from './locales/en.json'

function Probe({ k = 'nope.key', vars }) {
  const { t, lang } = useI18n()
  return (
    <p data-testid="out" data-lang={lang}>
      {t(k, vars)}
    </p>
  )
}

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = ''
})
afterEach(() => vi.restoreAllMocks())

describe('i18n', () => {
  it('interpolates vars', () => {
    wrap(<Probe k="state.partial" vars={{ x: 3, y: 7 }} />)
    expect(screen.getByTestId('out')).toHaveTextContent('Deels klaar (3 van 7)')
  })

  it('falls back to the key for a missing entry', () => {
    wrap(<Probe />)
    expect(screen.getByTestId('out')).toHaveTextContent('nope.key')
  })

  it('nl and en have identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(nl).sort())
  })

  it('has the keys later tasks rely on', () => {
    for (const k of ['state.off', 'overview.error', 'step.anonymize', 'tier.quick.lead', 'insights.row.sub']) {
      expect(nl[k]).toBeTruthy()
      expect(en[k]).toBeTruthy()
    }
  })

  it('toggle switches language, persists and sets <html lang>', async () => {
    wrap(<><LanguageToggle /><Probe k="state.done" /></>)
    expect(document.documentElement.lang).toBe('nl')
    expect(screen.getByTestId('out')).toHaveTextContent('Klaar')
    expect(screen.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(localStorage.getItem('nse.lang')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByTestId('out')).toHaveTextContent('Done')
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('restores a stored language', () => {
    localStorage.setItem('nse.lang', 'en')
    wrap(<Probe />)
    expect(screen.getByTestId('out')).toHaveAttribute('data-lang', 'en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('defaults to nl when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    wrap(<><LanguageToggle /><Probe /></>)
    expect(screen.getByTestId('out')).toHaveAttribute('data-lang', 'nl')
    await userEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByTestId('out')).toHaveAttribute('data-lang', 'en')
  })

  it('formats numbers, dates and bytes per locale', () => {
    function F() {
      const { formatNumber, formatBytes, formatDate } = useI18n()
      return <p data-testid="f">{formatNumber(1234.5)}|{formatBytes(1.2e9)}|{formatDate('2026-10-31T13:05:00Z').includes('2026') ? 'y' : 'n'}</p>
    }
    wrap(<F />)
    expect(screen.getByTestId('f')).toHaveTextContent('1.234,5|1,2 GB|y')
  })
})
