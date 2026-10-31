import nl from '../i18n/locales/nl.json'
import { gateErrorMessage } from './gateError'

const t = (key, vars) =>
  nl[key] === undefined ? key : nl[key].replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m))

const refusal = (code, params) => Object.assign(new Error('raw backend text'), { status: 409, code, params })

describe('gateErrorMessage', () => {
  it('error.busy names the running step with the gate.busy copy', () => {
    expect(gateErrorMessage(t, refusal('error.busy', { step: 'vectors' }))).toBe('Wacht tot stap 2 klaar is')
    expect(gateErrorMessage(t, refusal('error.busy', { step: 'insights' }))).toBe('Wacht tot stap 4 klaar is')
  })

  it('error.blocked names the step to finish first', () => {
    expect(gateErrorMessage(t, refusal('error.blocked', { step: 'anonymize' }))).toBe(
      'Dit kan nog niet: rond eerst stap 1 af (Persoonsgegevens verwijderen).',
    )
  })

  it('anything else is not a gate refusal', () => {
    expect(gateErrorMessage(t, refusal('error.backend', null))).toBeNull()
    expect(gateErrorMessage(t, new Error('offline'))).toBeNull()
    expect(gateErrorMessage(t, null)).toBeNull()
  })
})
