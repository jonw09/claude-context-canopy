// Renders the README's screenshots from the band's own layout code, so the
// pictures always match what the plugin draws.
//
//   npm i -g typescript playwright   (once)
//   node scripts/render-images.mjs
//
// Writes docs/images/*.png. Needs Chromium for Playwright and, for the exact
// look, the JetBrains Mono font installed.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'docs', 'images')
const build = mkdtempSync(join(tmpdir(), 'canopy-'))
const require = createRequire(import.meta.url)

execFileSync(
  'tsc',
  ['--outDir', build, '--module', 'commonjs', '--target', 'es2023', '--skipLibCheck', '--noCheck', '--rootDir', root,
    ...['layout', 'format', 'palette', 'tree', 'settings'].map(f => join(root, 'hooks', `${f}.ts`))],
  // Run from the build folder so the plugin's own tsconfig.json is not picked up.
  { stdio: 'inherit', cwd: build },
)
writeFileSync(join(build, 'package.json'), '{ "type": "commonjs" }')
const { buildLines } = require(join(build, 'hooks', 'layout.js'))
const { settingsFrom } = require(join(build, 'hooks', 'settings.js'))

let playwright
try {
  playwright = await import('playwright')
} catch {
  const globalRoot = execFileSync('npm', ['root', '-g']).toString().trim()
  playwright = await import(join(globalRoot, 'playwright', 'index.mjs'))
}

const NOW = Date.parse('2026-10-21T10:00:00Z')
const at = minutes => new Date(NOW + minutes * 60_000).toISOString()
const MAIN = { model: 'claude-opus-5-5', window: 200_000, compactAt: 167_000 }
const LIMITS = [
  { kind: 'five_hour', percentUsed: 48, resetsAt: at(134) },
  { kind: 'seven_day', percentUsed: 21, resetsAt: at(6120) },
]

const view = patch => ({
  width: 104,
  now: NOW,
  limits: LIMITS,
  planSplit: { five_hour: { opus: 58, sonnet: 27, haiku: 15 }, seven_day: { opus: 64, sonnet: 24, haiku: 12 } },
  sessionTokens: { opus: 337_000, sonnet: 190_000, haiku: 85_000 },
  usd: 4.87,
  main: { ...MAIN, tokens: 74_000, activity: undefined },
  roster: [],
  loops: {},
  isCollapsed: false,
  settings: settingsFrom({}),
  ...patch,
})

const agent = (id, type, parentId, description, status = 'running', name) => ({ id, type, parentId, description, status, name })

const TEAM = {
  roster: [
    agent('e', 'Explore', undefined, 'Map the order flow'),
    agent('r', 'reviewer', undefined, 'Review the billing change'),
    agent('c', 'Explore', 'r', 'Find callers of charge()'),
    agent('t', 'general-purpose', undefined, 'Write order tests', 'running', 'test-writer'),
  ],
  loops: {
    e: { model: 'claude-haiku-5-5', tokens: 36_000, activity: 'Grep "OrderStatus" in src' },
    r: { model: 'claude-sonnet-5-5', tokens: 118_000, activity: 'Read billing/invoice.ts' },
    c: { model: 'claude-haiku-5-5', tokens: 154_000, activity: 'Glob src/**/*.ts' },
    t: { model: 'claude-sonnet-5-5', tokens: 52_000, activity: 'Write tests/orders.test.ts' },
  },
}

const SCREENS = [
  { file: 'band.png', title: 'Three agents at work, one nested', v: view(TEAM) },
  {
    file: 'enterprise.png',
    title: 'An Enterprise seat with a spend limit',
    v: view({
      planName: 'Enterprise',
      limits: [{ kind: 'spend_limit', percentUsed: 64, resetsAt: at(13_000) }],
      planSplit: { spend_limit: { opus: 70, sonnet: 30 } },
      sessionTokens: { opus: 210_000, sonnet: 80_000 },
      usd: 18.4,
      main: { ...MAIN, tokens: 52_000, activity: 'Read infra/main.tf' },
    }),
  },
  {
    file: 'solo.png',
    title: 'A solo session on Pro',
    v: view({
      planSplit: { five_hour: { opus: 91, haiku: 9 }, seven_day: { opus: 88, haiku: 12 } },
      sessionTokens: { opus: 171_000, haiku: 13_000 },
      usd: 1.12,
      main: { ...MAIN, tokens: 82_000, activity: 'Edit routes/orders.ts' },
    }),
  },
  {
    file: 'limit.png',
    title: 'Near the limit',
    v: view({
      limits: [
        { kind: 'five_hour', percentUsed: 93, resetsAt: at(41) },
        { kind: 'seven_day', percentUsed: 71, resetsAt: at(1620) },
      ],
      main: { ...MAIN, tokens: 151_000, activity: 'Bash: npm test' },
    }),
  },
  { file: 'collapsed.png', title: 'Collapsed with /canopy', v: view({ ...TEAM, isCollapsed: true }) },
  { file: 'narrow.png', title: 'A narrow terminal (60 columns)', v: view({ ...TEAM, width: 60 }) },
]

const COLOUR = { success: '#4ade80', warning: '#fbbf24', error: '#f87171' }
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function lineHtml(line) {
  // Each segment takes exactly its own columns, whatever font a glyph falls back to.
  return line
    .map(s => {
      // Bars as solid blocks of colour rather than glyphs, which leave seams.
      if (/^▆+$/.test(s.text)) {
        const fill = s.dim ? '#262a32' : COLOUR[s.color] ?? s.color
        return `<span style="width:${s.text.length}ch;height:0.85em;margin-top:0.4em;background:${fill}"></span>`
      }
      const style = [
        `width:${s.text.length}ch`,
        s.color ? `color:${COLOUR[s.color] ?? s.color}` : '',
        s.dim ? 'color:var(--dim)' : '',
        s.bold ? 'font-weight:700' : '',
      ].filter(Boolean).join(';')

      return `<span style="${style}">${esc(s.text)}</span>`
    })
    .join('')
}

function page({ title, v }) {
  const lines = buildLines(v)
  const cols = v.width + 5

  return `<!doctype html><meta charset="utf-8"><style>
  :root { --bg:#15181e; --fg:#d9dce2; --dim:#6d7380; --line:#2a2f38 }
  body { margin:0; background:transparent; font-family:"JetBrains Mono","DejaVu Sans Mono",monospace; }
  .term { display:inline-block; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .bar { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--line); font-size:12px; color:var(--dim); }
  .dot { width:11px; height:11px; border-radius:50% } .t { margin-left:10px }
  .screen { padding:14px 18px 12px; font-size:14px; line-height:1.55; white-space:pre; width:${cols}ch; }
  .row { display:flex; } .row span { display:inline-block; overflow:hidden; flex:none }
  .band { position:relative; padding:12px 0 8px } .mark { position:absolute; right:0; top:12px; line-height:1.55; color:var(--dim) }
  .prompt { border:1px solid #4a505c; border-radius:7px; padding:4px 10px; margin-top:6px }
  .caret { background:var(--fg); color:transparent } .dim { color:var(--dim) }
  </style>
  <div class="term"><div class="bar"><span class="dot" style="background:#f87171"></span><span class="dot" style="background:#fbbf24"></span><span class="dot" style="background:#4ade80"></span><span class="t">${esc(title)}</span></div>
  <div class="screen">${[
    `<div class="dim">⏺ ${esc(v.roster.length ? `Launched ${v.roster.length} agents` : 'Updated src/routes/orders.ts')}</div>`,
    `<div class="band">${lines.map(l => `<div class="row">${lineHtml(l)}</div>`).join('')}<span class="mark">${v.isCollapsed ? '[+]' : '[-]'}</span></div>`,
    '<div class="prompt">&gt; <span class="caret">_</span></div>',
    '<div class="dim">  acme-shop · main</div>',
  ].join('')}</div></div>`
}

mkdirSync(out, { recursive: true })
const browser = await playwright.chromium.launch()
const tab = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } })
for (const screen of SCREENS) {
  await tab.setContent(page(screen))
  await tab.locator('.term').screenshot({ path: join(out, screen.file), omitBackground: true })
  console.log(`docs/images/${screen.file}`)
}
await browser.close()
