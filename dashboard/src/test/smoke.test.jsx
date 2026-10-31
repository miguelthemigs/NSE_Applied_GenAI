import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NavBar from '../components/NavBar'

describe('smoke', () => {
  it('renders the navigation bar', () => {
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })
})
