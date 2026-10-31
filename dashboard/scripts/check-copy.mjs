// Fails (exit 1) when JSX under src/components or src/pages contains a banned
// literal, an emoji, or the glyphs U+2713 and U+00D7 (use <Icon> instead). Inline <svg> is also flagged in
// src/components/pipeline/ and the step components, unless the line (or the one above) carries `check-copy-allow-svg`. All user-visible copy must go through t().
// Usage: node scripts/check-copy.mjs [--files path1 path2 ...]
// (--files needs at least one path, otherwise exit 2.)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BANNED } from './banned-copy.mjs'

const ROOT = process.cwd()
const SCAN_DIRS = ['src/components', 'src/pages']
const EMOJI = /\p{Extended_Pictographic}/u
const GLYPHS = ['\u2713', '\u00D7']
const SVG_SCOPE = [
  'src/components/pipeline/',
  'src/components/AnonymizerTab.jsx',
  'src/components/VectorDBBuilder.jsx',
  'src/components/ThemeReranker.jsx',
  'src/components/QueryTab.jsx',
  'src/pages/PipelineDemo.jsx',
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.jsx')) out.push(p)
  }
  return out
}

const args = process.argv.slice(2)
const filesIdx = args.indexOf('--files')
let files
if (filesIdx >= 0) {
  files = args.slice(filesIdx + 1).filter((a) => !a.startsWith('--'))
  if (files.length === 0) {
    console.error('check-copy: --files needs at least one path. Usage: check-copy.mjs [--files path1 path2 ...]')
    process.exit(2)
  }
} else {
  files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
}

function isLiteralHit(line, banned) {
  for (let i = line.indexOf(banned); i >= 0; i = line.indexOf(banned, i + 1)) {
    if (!/[A-Za-z0-9_]/.test(line[i - 1] ?? '')) return true
  }
  return false
}

let hits = 0
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    // not part of a longer identifier (e.g. the ThemeReranker component name)
    const why = BANNED.filter((b) => line.includes(b) && isLiteralHit(line, b)).map((b) => `"${b}"`)
    if (EMOJI.test(line)) why.push('emoji')
    for (const g of GLYPHS) if (line.includes(g)) why.push(`glyph U+${g.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    const rel = relative(ROOT, f).split('\\').join('/')
    if (line.includes('<svg') && SVG_SCOPE.some((p) => rel.startsWith(p))
      && !line.includes('check-copy-allow-svg') && !(lines[i - 1] ?? '').includes('check-copy-allow-svg')) {
      why.push('inline <svg> (use <Icon>)')
    }
    if (why.length) {
      hits += 1
      console.log(`${relative(ROOT, f)}:${i + 1}: ${why.join(', ')}`)
    }
  })
}
if (hits) {
  console.error(`check-copy: ${hits} line(s) with banned copy`)
  process.exit(1)
}
console.log('check-copy: clean')
