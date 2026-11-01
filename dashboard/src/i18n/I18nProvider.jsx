import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import nl from './locales/nl.json'
import en from './locales/en.json'

const STORAGE_KEY = 'nse.lang'
const DICTS = { nl, en }
const LOCALES = { nl: 'nl-NL', en: 'en-GB' }
const DATE_OPTIONS = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }

function readStoredLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'en' || v === 'nl' ? v : 'nl'
  } catch {
    return 'nl'
  }
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l) => {
    if (l !== 'nl' && l !== 'en') return
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* storage blocked: the choice lasts for this session only */
    }
  }, [])

  const value = useMemo(() => {
    const locale = LOCALES[lang]
    const dict = DICTS[lang]
    const t = (key, vars) => {
      const s = dict[key]
      if (s === undefined) return key
      if (!vars) return s
      return s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
    }
    const formatNumber = (n) => new Intl.NumberFormat(locale).format(n)
    // Missing or invalid input renders as '' rather than "NaN GB" or a RangeError.
    const formatDate = (d) => {
      if (d == null || d === '') return ''
      const date = d instanceof Date ? d : new Date(d)
      return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale, DATE_OPTIONS).format(date)
    }
    const formatBytes = (bytes) => {
      if (bytes == null || bytes === '' || !Number.isFinite(Number(bytes))) return ''
      return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(bytes) / 1e9)} GB`
    }
    return { lang, setLang, t, formatNumber, formatDate, formatBytes }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
