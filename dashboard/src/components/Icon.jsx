export default function Icon({ name, filled = false, className = '', label }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
  return (
    <span
      className={`material-symbols-outlined ${className}`.trim()}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
      {...a11y}
    >
      {name}
    </span>
  )
}
