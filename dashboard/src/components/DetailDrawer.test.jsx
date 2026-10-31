import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider.jsx'
import DetailDrawer from './DetailDrawer.jsx'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('DetailDrawer', () => {
  it('translates a missing model and keeps the raw text behind "Details tonen"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ status: 'error', code: 'error.model_missing', error: 'model not downloaded; start it from step 4' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<I18nProvider><DetailDrawer theme={{ id: 1, name: 'Teachers', subthemes: [], quotes: [] }} /></I18nProvider>)

    expect(await screen.findByText('Het AI-model staat nog niet op deze computer. Start het eerst bij stap 4, Samenvattingen schrijven.')).toBeInTheDocument()
    // (The drawer animates in from opacity 0, so check the disclosure, not visibility.)
    const details = screen.getByText('model not downloaded; start it from step 4').closest('details')
    expect(details).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('Details tonen'))
    expect(details).toHaveAttribute('open')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).allow_model_download).toBe(true)
  })
})
