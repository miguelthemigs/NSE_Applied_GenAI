import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../../i18n/I18nProvider.jsx'
import { TIERS } from '../../config/modelTiers'
import TierPicker from './TierPicker.jsx'

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

const CATALOG = {
  tiers: [
    { tier: 'quick', step: 'insights', model_id: TIERS.quick.insights, size_bytes: 2.62e9, cached: false },
    { tier: 'balanced', step: 'insights', model_id: TIERS.balanced.insights, size_bytes: 6.2e9, cached: true },
    { tier: 'thorough', step: 'insights', model_id: TIERS.thorough.insights, size_bytes: 16.9e9, cached: false },
  ],
  advanced: { vectors: [], insights: [TIERS.quick.insights, TIERS.balanced.insights, 'unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL'] },
}

function setup(props = {}) {
  const onChange = vi.fn()
  const onAdvancedChange = vi.fn()
  render(
    <I18nProvider>
      <TierPicker step="insights" value="balanced" onChange={onChange} onAdvancedChange={onAdvancedChange} {...props} />
    </I18nProvider>,
  )
  return { onChange, onAdvancedChange }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(CATALOG)))
})

afterEach(() => vi.unstubAllGlobals())

describe('TierPicker', () => {
  it('shows Balanced selected with the recommended badge', async () => {
    setup()
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Gebalanceerd/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Snel/ })).not.toBeChecked()
    expect(screen.getByText('Aanbevolen')).toBeInTheDocument()
  })

  it('picking "Snel" calls onChange with the tier and its model id', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('radio', { name: /Snel/ }))
    expect(onChange).toHaveBeenCalledWith('quick', TIERS.quick.insights)
  })

  it('shows size chips with a decimal comma and the cached chip', async () => {
    setup()
    expect(await screen.findByText('2,6 GB')).toBeInTheDocument()
    expect(screen.getByText('6,2 GB')).toBeInTheDocument()
    expect(screen.getByText('16,9 GB')).toBeInTheDocument()
    expect(screen.getByText('Al op deze computer')).toBeInTheDocument()
    expect(screen.getAllByText('Eenmalige download')).toHaveLength(2)
  })

  it('hides technical ids until Advanced is opened', async () => {
    setup()
    await screen.findByText('2,6 GB')
    const option = screen.getByRole('option', { name: TIERS.balanced.insights, hidden: true })
    expect(option).not.toBeVisible()
    await userEvent.click(screen.getByText('Geavanceerd'))
    expect(screen.getByRole('option', { name: TIERS.balanced.insights })).toBeVisible()
  })

  it('an Advanced id wins: no tier is selected and the choice is reported', async () => {
    const other = 'unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL'
    const { onAdvancedChange } = setup()
    await screen.findByText('2,6 GB')
    await userEvent.click(screen.getByText('Geavanceerd'))
    await userEvent.selectOptions(screen.getByRole('combobox'), other)
    expect(onAdvancedChange).toHaveBeenCalledWith(other)
  })

  it('shows no tier as selected while an advanced model is chosen', () => {
    setup({ advancedModelId: 'unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL' })
    screen.getAllByRole('radio').forEach((r) => expect(r).not.toBeChecked())
  })

  it('falls back to three tiers without sizes or cached chips when the lookup fails', async () => {
    fetch.mockRejectedValue(new TypeError('offline'))
    setup()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByText(/GB/)).not.toBeInTheDocument()
    expect(screen.queryByText('Al op deze computer')).not.toBeInTheDocument()
  })
})
