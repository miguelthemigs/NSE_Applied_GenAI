import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import LanguageToggle from './LanguageToggle.jsx'
import Icon from './Icon.jsx'

export default function NavBar() {
  const location = useLocation()
  const { t } = useI18n()

  const links = [
    { to: '/', label: t('nav.overview'), icon: 'dashboard' },
    { to: '/pipeline-demo', label: t('nav.pipeline'), icon: 'sync' },
  ]

  return (
    <nav className="sticky top-0 z-50 bg-primary text-on-primary">
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 h-14 sm:h-[60px] flex items-center gap-3 sm:gap-7">
        <Link
          to={{ pathname: '/', search: location.search }}
          className="font-headline font-extrabold text-[17px] sm:text-lg tracking-[-0.01em] text-on-primary no-underline whitespace-nowrap"
        >
          NSE Insights
        </Link>

        <div className="flex items-center gap-1 grow">
          {links.map((link) => {
            const isActive = location.pathname === link.to
            return (
              <Link
                key={link.to}
                to={link.to === '/' ? { pathname: '/', search: location.search } : link.to}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2 min-h-[40px] px-3 py-2 rounded-xl text-[15px] no-underline transition-colors duration-150 ${
                  isActive ? 'bg-primary-container text-on-primary font-semibold' : 'text-primary-fixed font-medium hover:text-on-primary hover:bg-primary-container/60'
                }`}
              >
                <Icon name={link.icon} className="sm:hidden text-[20px]" />
                <span className="sr-only sm:not-sr-only">{link.label}</span>
              </Link>
            )
          })}
        </div>

        <LanguageToggle />
      </div>
    </nav>
  )
}
