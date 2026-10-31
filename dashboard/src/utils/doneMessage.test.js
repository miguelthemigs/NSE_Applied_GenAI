import nl from '../i18n/locales/nl.json'
import en from '../i18n/locales/en.json'
import { continueHintKey, doneMessage } from './doneMessage'

// Same interpolation as I18nProvider's t().
const makeT = (dict) => (key, vars) =>
  dict[key] === undefined ? key : dict[key].replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m))
const t = makeT(nl)

describe('doneMessage', () => {
  it('anonymize with misses: the done text with the numbers', () => {
    expect(doneMessage('anonymize', { rows: 300, removed: 409, review: 1 }, t)).toBe(
      'Klaar. 300 antwoorden gecontroleerd, 409 persoonsgegevens verwijderd, 1 om na te kijken.',
    )
  })

  it('anonymize without misses: the "all clear" variant', () => {
    expect(doneMessage('anonymize', { rows: 300, removed: 409, review: 0, verified: true }, t)).toBe(
      'Klaar. 300 antwoorden gecontroleerd, 409 persoonsgegevens verwijderd. Alles in orde.',
    )
  })

  it('anonymize unverified never says "all clear"', () => {
    const text = doneMessage('anonymize', { rows: 300, removed: 409, review: 0, verified: false }, t)
    expect(text).not.toContain('Alles in orde')
    expect(text).toContain('300')
    expect(makeT(en)('done.anonymize.unverified', { rows: 1, removed: 2 })).not.toContain('All clear')
  })

  it('vectors: documents and the short tier name', () => {
    expect(doneMessage('vectors', { documents: 900, tier: 'balanced' }, t)).toBe('Klaar. 900 antwoorden zijn doorzoekbaar (model: Gebalanceerd).')
    expect(doneMessage('vectors', { documents: 900, tier: 'balanced' }, makeT(en))).toBe('Done. 900 answers are ready for search (Balanced model).')
  })

  it('vectors without a known tier leaves the model out (no technical ids)', () => {
    expect(doneMessage('vectors', { documents: 900, tier: null, model: 'Octen/Octen-Embedding-0.6B' }, t)).toBe('Klaar. 900 antwoorden zijn doorzoekbaar.')
  })

  it('rerank and insights use their summary fields', () => {
    expect(doneMessage('rerank', { ambiguous: 57, changed: 12, low_information: 3 }, t)).toBe(
      'Klaar. 57 twijfelgevallen opnieuw gelezen; 12 kregen een beter passend thema. 3 antwoorden zonder echte inhoud zijn apart gezet.',
    )
    expect(doneMessage('insights', { themes_done: 7, themes_total: 7 }, t)).toBe("Klaar. Samenvattingen voor 7 van 7 thema's staan op het Overzicht.")
  })

  it('formats numbers with the given formatter and survives a missing summary', () => {
    const fmt = (n) => new Intl.NumberFormat('nl-NL').format(n)
    expect(doneMessage('vectors', { documents: 1234, tier: 'quick' }, t, fmt)).toBe('Klaar. 1.234 antwoorden zijn doorzoekbaar (model: Snel).')
    expect(doneMessage('insights', null, t)).toBe("Klaar. Samenvattingen voor 0 van 0 thema's staan op het Overzicht.")
  })
})

describe('continueHintKey', () => {
  it('explains the review gate and the unverified gate, nothing otherwise', () => {
    expect(continueHintKey('needs_review')).toBe('done.review.ackFirst')
    expect(continueHintKey('unverified')).toBe('done.unverified.checkFirst')
    expect(continueHintKey('done')).toBeNull()
    expect(continueHintKey('stale')).toBeNull()
  })
})
