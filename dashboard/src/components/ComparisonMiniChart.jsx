import Icon from './Icon.jsx'

export default function ComparisonMiniChart({ theme, filters }) {
  if (!theme) return null

  const activeSv = filters?.studievorm ?? 'All'

  const bars = [
    { key: 'voltijd', label: 'Full-time',  value: theme.comparison.voltijd,  color: '#006a6a' },
    { key: 'deeltijd', label: 'Part-time', value: theme.comparison.deeltijd, color: '#90efef' },
    { key: 'duaal',   label: 'Dual',       value: theme.comparison.duaal,    color: '#c2c6d1' },
  ]

  return (
    <div className="bg-surface-container-low rounded-xl p-4 md:p-6 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base md:text-lg font-bold font-headline text-primary">Study Mode</h3>
        <Icon name="compare_arrows" className="text-outline text-xl" />
      </div>
      <div className="flex flex-col gap-3">
        {bars.map((bar) => {
          const isActive = activeSv === bar.label || activeSv === 'All'
          return (
            <div key={bar.key} className="flex flex-col gap-1" style={{ opacity: isActive ? 1 : 0.4 }}>
              <div className="flex justify-between">
                <span className={`text-[11px] font-bold ${activeSv === bar.label ? 'text-primary' : 'text-on-surface-variant'}`}>
                  {bar.label}
                  {activeSv === bar.label && (
                    <span className="ml-1.5 text-[9px] uppercase tracking-wider bg-primary text-white px-1.5 py-0.5 rounded">
                      active
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-bold text-on-surface-variant">{bar.value}%</span>
              </div>
              <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${bar.value}%`,
                    background: bar.color,
                    outline: activeSv === bar.label ? '2px solid #002f59' : 'none',
                    outlineOffset: '2px',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-on-surface-variant mt-auto">
        Response share for{' '}
        <span className="font-semibold text-primary">{theme.name}</span> by study mode.
      </p>
    </div>
  )
}
