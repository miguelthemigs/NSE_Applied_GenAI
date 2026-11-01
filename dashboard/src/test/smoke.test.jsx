import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { I18nProvider } from '../i18n/I18nProvider.jsx'

describe('smoke', () => {
  it('renders the navigation bar', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <NavBar />
        </MemoryRouter>
      </I18nProvider>,
    )
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })
})
