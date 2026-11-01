import { useEffect, useRef } from 'react'
import { useThemeSummary } from '../hooks/useThemeSummary'
import { useI18n } from '../i18n/I18nProvider'
import { llmErrorKey } from '../utils/downloadProgress'
import Icon from './Icon.jsx'

// Removed static DonutChart as per user request

export default function DetailDrawer({ theme, onClose }) {
  const { t } = useI18n()
  const drawerRef = useRef(null)
  const { liveData, loadingLive } = useThemeSummary(theme)

  useEffect(() => {
    if (drawerRef.current) {
      drawerRef.current.style.transform = 'translateX(100%)'
      drawerRef.current.style.opacity = '0'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (drawerRef.current) {
            drawerRef.current.style.transition =
              'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-out'
            drawerRef.current.style.transform = 'translateX(0)'
            drawerRef.current.style.opacity = '1'
          }
        })
      })
    }
  }, [theme?.id])

  if (!theme) return null

  return (
    <div
      ref={drawerRef}
      className="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-ambient border border-outline-variant/10"
    >
      {/* Header */}
      <div
        className="p-4 md:p-6 text-white relative"
        style={{ background: 'linear-gradient(135deg, #002F59 0%, #00467F 100%)' }}
      >
        <div className="flex justify-between items-start">
          <h3 className="text-xl font-bold font-headline">{theme.name}</h3>
          <div className="flex items-center gap-2">
            {onClose && (
              <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors">
                <Icon name="close" className="text-sm" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 md:p-6 space-y-6">

        {/* Gemma 4 Summary */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <Icon name="psychology" className="text-blue-600" />
              <h4 className="text-sm font-bold text-blue-900">Gemma 4 Insights</h4>
            </div>
            {loadingLive && (
              <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-blue-500 tracking-wider animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                Loading insights...
              </span>
            )}
          </div>

          {loadingLive ? (
            <div className="space-y-2 py-2">
              <div className="h-2 bg-blue-200/50 rounded animate-pulse w-full"></div>
              <div className="h-2 bg-blue-200/50 rounded animate-pulse w-5/6"></div>
              <div className="h-2 bg-blue-200/50 rounded animate-pulse w-4/6"></div>
            </div>
          ) : liveData?.error ? (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
              <p>{t(llmErrorKey(liveData.code) ?? 'detail.queryFailed')}</p>
              <details>
                <summary className="cursor-pointer">{t('action.details')}</summary>
                <p className="mt-1 break-words">{liveData.error}</p>
              </details>
            </div>
          ) : liveData ? (
            <div className="space-y-4 animate-in fade-in duration-500">
              <p className="text-sm text-blue-800 leading-relaxed bg-white/50 p-3 rounded-lg border border-blue-100/50">
                {liveData.summary}
              </p>
            </div>
          ) : (
            <p className="text-xs text-blue-600/70 italic">{t('detail.queryFailed')}</p>
          )}
        </div>

        {/* Frequency */}
        <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
          <Icon name="bar_chart" className="text-outline text-sm" />
          <span className="text-sm font-semibold text-on-surface">
            Relevant responses for this theme:{' '}
            <span className="text-primary font-bold">{theme.percentage}%</span>
          </span>
        </div>

        {/* Sub-themes */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
            Key Sub-themes Detected
          </h4>
          <div className="flex flex-wrap gap-2">
            {(liveData?.subthemes?.length > 0 ? liveData.subthemes : theme.subthemes).map((st, i) => (
              <span
                key={i}
                className="px-3 py-1 bg-surface-container rounded-full text-[10px] font-semibold text-on-surface-variant border border-outline/10 shadow-sm"
              >
                {st}
              </span>
            ))}
          </div>
        </div>

        {/* Quotes */}
        <div className="space-y-3 pt-2 border-t border-outline-variant/10">
          <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
            Actual Student Comments
          </h4>
          {(liveData?.quotes?.length > 0 ? liveData.quotes : theme.quotes).map((q, i) => (
            <blockquote
              key={i}
              className="bg-surface p-4 rounded-xl border-l-4 border-blue-500 italic text-xs text-on-surface-variant leading-relaxed shadow-sm"
            >
              "{q}"
            </blockquote>
          ))}
          <p className="text-[10px] text-on-surface-variant/50 italic">
            * Actual verbatim quotes retrieved from the database.
          </p>
        </div>

      </div>
    </div>
  )
}
