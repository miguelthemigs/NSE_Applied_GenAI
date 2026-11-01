import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../i18n/I18nProvider.jsx'
import HeroBanner from './HeroBanner.jsx'

const THEMES = [{ name: 'Teaching', responseCount: 12, subthemes: ['A'] }]

function renderHero(lastUpdated) {
  render(
    <I18nProvider>
      <HeroBanner themes={THEMES} lastUpdated={lastUpdated} />
    </I18nProvider>,
  )
}

beforeEach(() => localStorage.clear())

describe('HeroBanner', () => {
  it('shows "last updated" from the pipeline status', () => {
    renderHero('2026-10-31T14:12:00Z')
    expect(screen.getByText(/^Laatst bijgewerkt: .*31 okt 2026/)).toBeInTheDocument()
  })

  it('omits the line when last_updated is null or invalid', () => {
    renderHero(null)
    expect(screen.queryByText(/Laatst bijgewerkt/)).toBeNull()
  })
})
