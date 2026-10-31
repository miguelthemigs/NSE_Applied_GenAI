import { useI18n } from '../i18n/I18nProvider.jsx'
import Icon from './Icon.jsx'

const LANGS = [
  { code: 'nl', label: 'NL' },
  { code: 'en', label: 'EN' },
]

export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <div role="group" aria-label={t('lang.toggle')} className="flex items-center gap-1 rounded-full bg-white/10 p-0.5">
      <Icon name="translate" className="text-lg text-primary-fixed-dim pl-1.5" />
      {LANGS.map(({ code, label }) => {
        const active = lang === code
        return (
          <button
            key={code}
            type="button"
            aria-pressed={active}
            onClick={() => setLang(code)}
            className={`rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
              active ? 'bg-white text-primary' : 'bg-transparent text-primary-fixed-dim hover:text-white'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
