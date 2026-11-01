export default function Icon({ name, filled = false, className = '', label, style }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
  return (
    <span
      // The icon is drawn from its ligature name ("lock", "check_circle"); browser
      // page translation would rewrite that text and break the glyph.
      translate="no"
      className={`material-symbols-outlined notranslate ${className}`.trim()}
      style={filled || style ? { ...style, ...(filled ? { fontVariationSettings: "'FILL' 1" } : {}) } : undefined}
      {...a11y}
    >
      {name}
    </span>
  )
}
