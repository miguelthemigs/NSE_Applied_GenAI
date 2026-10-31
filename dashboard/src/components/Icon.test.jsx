import { render, screen } from '@testing-library/react'
import Icon from './Icon.jsx'

describe('Icon', () => {
  it('is hidden from assistive tech without a label', () => {
    const { container } = render(<Icon name="check_circle" />)
    const el = container.querySelector('.material-symbols-outlined')
    expect(el).toHaveTextContent('check_circle')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('exposes role img and its name with a label', () => {
    render(<Icon name="check_circle" label="Klaar" />)
    const el = screen.getByRole('img', { name: 'Klaar' })
    expect(el).not.toHaveAttribute('aria-hidden')
  })

  it('applies FILL when filled', () => {
    const { container } = render(<Icon name="insights" filled className="x" />)
    const el = container.querySelector('.material-symbols-outlined')
    expect(el.style.fontVariationSettings).toContain("'FILL' 1")
    expect(el).toHaveClass('x')
  })
})
