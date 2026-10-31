import { useState, useRef, useEffect, useMemo } from 'react'
import { useI18n } from '../i18n/I18nProvider'

export default function FilterDropdown({ icon, label, value, options, availableOptions, onChange }) {
  const { t } = useI18n()
  const show = (opt) => (opt === 'All' ? t('common.all') : opt)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  const searchInputRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Reset and focus the search box whenever the dropdown opens
  useEffect(() => {
    if (open) {
      setSearch('')
      searchInputRef.current?.focus()
    }
  }, [open])

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((opt) => String(show(opt)).toLowerCase().includes(query))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, search, t])

  function isAvailable(opt) {
    if (!availableOptions) return true
    if (opt === 'All' || opt === value) return true
    return availableOptions.includes(opt)
  }

  function select(opt) {
    onChange(opt)
    setOpen(false)
  }

  const isActive = open

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left ${
          isActive
            ? 'bg-primary text-white'
            : 'bg-surface-container-low text-primary hover:bg-surface-container'
        }`}
      >
        <span className="material-symbols-outlined text-lg flex-shrink-0">{icon}</span>
        <div className="flex flex-col flex-1 min-w-0">
          <span className={`text-[9px] uppercase tracking-widest font-bold ${isActive ? 'opacity-70' : 'opacity-60'}`}>
            {label}
          </span>
          <span className={`text-sm font-semibold truncate ${isActive ? 'text-white' : 'text-on-surface'}`}>
            {show(value)}
          </span>
        </div>
        <span
          className={`material-symbols-outlined text-sm flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/20 z-50 overflow-hidden">
          {options.length > 6 && (
            <div className="p-2 border-b border-outline-variant/15">
              <div className="relative">
                <span className="material-symbols-outlined text-sm text-outline absolute left-2.5 top-1/2 -translate-y-1/2">
                  search
                </span>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={t('common.search')}
                  className="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}
          <div className="overflow-y-auto max-h-[360px] overscroll-contain">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => {
              const available = isAvailable(opt)
              return (
                <button
                  key={opt}
                  onClick={() => select(opt)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                    opt === value
                      ? 'bg-primary/8 text-primary font-semibold'
                      : available
                      ? 'text-on-surface hover:bg-surface-container-low'
                      : 'text-on-surface-variant/35 cursor-default'
                  }`}
                >
                  <span>{show(opt)}</span>
                  <span className="flex items-center gap-1">
                    {!available && (
                      <span className="material-symbols-outlined text-xs opacity-40">block</span>
                    )}
                    {opt === value && (
                      <span className="material-symbols-outlined text-sm text-primary">check</span>
                    )}
                  </span>
                </button>
              )
            })
          ) : (
            <p className="px-4 py-3 text-sm text-on-surface-variant/60 italic">{t('common.noMatches')}</p>
          )}
          </div>
        </div>
      )}
    </div>
  )
}
