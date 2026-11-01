import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import Icon from '../Icon'

const STORAGE_KEY = 'nse.welcomed'

function alreadyWelcomed() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false // storage blocked: show it on every load
  }
}

function markWelcomed() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* storage blocked: the banner shows again next time */
  }
}

/**
 * "Welcome back, your earlier work was saved" — once per browser session, and
 * only when there is earlier work (lastUpdated set).
 */
export default function WelcomeBackBanner({ lastUpdated }) {
  const { t, formatDate } = useI18n()
  const date = formatDate(lastUpdated)
  const [visible, setVisible] = useState(() => Boolean(date) && !alreadyWelcomed())

  useEffect(() => {
    if (visible) markWelcomed()
  }, [visible])

  if (!visible || !date) return null
  return (
    <div role="status" className="flex items-center gap-3 rounded-[12px] bg-primary-fixed text-primary px-4 py-3">
      <Icon name="info" className="text-[20px] shrink-0" />
      <span className="grow font-medium">{t('banner.welcomeBack', { date })}</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label={t('banner.dismiss')}
        className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-primary hover:bg-primary/10"
      >
        <Icon name="close" className="text-[18px]" />
      </button>
    </div>
  )
}
