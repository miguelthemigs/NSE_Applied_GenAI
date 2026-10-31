import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../../i18n/I18nProvider.jsx'
import WelcomeBackBanner from './WelcomeBackBanner.jsx'

const AT = '2026-10-31T14:12:00Z'

function renderBanner(lastUpdated = AT) {
  return render(
    <I18nProvider>
      <WelcomeBackBanner lastUpdated={lastUpdated} />
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('WelcomeBackBanner', () => {
  it('shows once per browser session', () => {
    const first = renderBanner()
    expect(screen.getByText(/^Welkom terug\. Je eerdere werk is bewaard \(laatst bijgewerkt .*2026.*\)\.$/)).toBeVisible()
    expect(sessionStorage.getItem('nse.welcomed')).toBe('1')
    first.unmount()
    renderBanner()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('can be dismissed', async () => {
    renderBanner()
    await userEvent.click(screen.getByRole('button', { name: 'Melding sluiten' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing without a last-updated date', () => {
    renderBanner(null)
    expect(screen.queryByRole('status')).toBeNull()
    expect(sessionStorage.getItem('nse.welcomed')).toBeNull()
  })

  it('shows every time, without crashing, when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const first = renderBanner()
    expect(screen.getByRole('status')).toBeVisible()
    first.unmount()
    renderBanner()
    expect(screen.getByRole('status')).toBeVisible()
  })
})
