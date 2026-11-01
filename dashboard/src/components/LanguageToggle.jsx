import { useI18n } from '../i18n/I18nProvider.jsx'
import Icon from './Icon.jsx'

const LANGS = [
  { code: 'nl', label: 'NL' },
  { code: 'en', label: 'EN' },
]

/** NL / EN segmented control on the navy nav bar (mockup Main: translate icon, then the track). */
export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    // translate="no": "en" is Dutch for "and", so browser page translation would relabel EN as "AND".
    <div role="group" aria-label={t('lang.toggle')} translate="no" className="notranslate flex items-center gap-2">
      <Icon name="translate" className="max-sm:hidden text-[18px] text-primary-fixed" />
      <div className="flex rounded-[10px] bg-primary-container p-[3px]">
        {LANGS.map(({ code, label }) => {
          const active = lang === code
          return (
            <button
              key={code}
              type="button"
              aria-pressed={active}
              onClick={() => setLang(code)}
              className={`min-h-8 rounded-xl px-2.5 sm:px-3 py-1.5 text-[13px] font-semibold leading-none transition-colors duration-150 ${
                active ? 'bg-surface-container-lowest text-primary' : 'bg-transparent text-primary-fixed hover:text-on-primary'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
