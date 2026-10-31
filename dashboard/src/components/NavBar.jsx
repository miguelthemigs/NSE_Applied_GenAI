import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nProvider.jsx'
import LanguageToggle from './LanguageToggle.jsx'

export default function NavBar() {
  const location = useLocation()
  const { t } = useI18n()

  const links = [
    { to: '/', label: t('nav.overview'), icon: 'dashboard' },
    { to: '/pipeline-demo', label: t('nav.pipeline'), icon: 'sync' },
  ]

  return (
    <nav className="sticky top-0 z-50 bg-primary/95 glass-panel border-b border-white/10 shadow-lg">
      <div className="max-w-[1280px] mx-auto px-4 md:px-8 flex items-center justify-between h-16">
        {/* Brand */}
        <Link
          to={{ pathname: '/', search: location.search }}
          className="flex items-center gap-2.5 group no-underline"
        >
          <span
            className="material-symbols-outlined text-2xl text-white/90 group-hover:text-white transition-colors"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            insights
          </span>
          <span className="text-lg font-extrabold font-headline text-white tracking-tight">
            NSE<span className="text-primary-fixed-dim"> Insights</span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {links.map((link) => {
            const isActive = location.pathname === link.to
            return (
              <Link
                key={link.to}
                to={link.to === '/' ? { pathname: '/', search: location.search } : link.to}
                className={`
                  relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                  transition-all duration-200 no-underline
                  ${isActive
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-white/70 hover:text-white hover:bg-white/8'
                  }
                `}
              >
                <span className="material-symbols-outlined text-lg">{link.icon}</span>
                <span className="hidden sm:inline">{link.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-fixed-dim rounded-full" />
                )}
              </Link>
            )
          })}
          <div className="ml-2">
            <LanguageToggle />
          </div>
        </div>
      </div>
    </nav>
  )
}
