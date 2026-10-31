// Fails (exit 1) when JSX under src/components or src/pages contains a banned
// literal or an emoji. All user-visible copy must go through t().
// Usage: node scripts/check-copy.mjs [--files path1 path2 ...]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src/components', 'src/pages']
const BANNED = [
  'Drop your CSV',
  'Vorige run',
  'Check uitvoeren',
  'Overslaan',
  'not_run',
  'Launch ',
  'Vector DB',
  'Reranker',
  'Processing Stream',
]
const EMOJI = /\p{Extended_Pictographic}/u

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
const files =
  filesIdx >= 0
    ? args.slice(filesIdx + 1).filter((a) => !a.startsWith('--'))
    : SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))

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
