// Renders the README's screenshots from the band's own layout code, so the
// pictures always match what the plugin draws.
//
//   npm i -g typescript playwright   (once)
//   node scripts/render-images.mjs [folder]
//
// Writes docs/images/*.png, or into `folder` to compare before copying them
// over. Needs Chromium for Playwright and, for the exact look, the JetBrains
// Mono font installed.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] ?? join(root, 'docs', 'images')
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
  spend: null,
  isUnlimited: false,
  main: { ...MAIN, tokens: 74_000, sent: 318_600, received: 18_400, activity: undefined },
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
    // Sent and received add up to the session's tokens: 337k Opus (main), 190k Sonnet, 85k Haiku.
    e: { model: 'claude-haiku-5-5', tokens: 36_000, sent: 31_200, received: 2_100, activity: 'Grep "OrderStatus" in src' },
    r: { model: 'claude-sonnet-5-5', tokens: 118_000, sent: 112_400, received: 6_100, activity: 'Read billing/invoice.ts' },
    c: { model: 'claude-haiku-5-5', tokens: 154_000, sent: 48_900, received: 2_800, activity: 'Glob src/**/*.ts' },
    t: { model: 'claude-sonnet-5-5', tokens: 52_000, sent: 63_800, received: 7_700, activity: 'Write tests/orders.test.ts' },
  },
}

// More agents than the band has rows for, so the tree is cropped and says what it hides.
const CROWD = {
  roster: [
    ...TEAM.roster,
    agent('m', 'Plan', undefined, 'Plan the schema migration', 'running', 'migration-planner'),
    agent('d', 'general-purpose', undefined, 'Update the API docs', 'running', 'docs-writer'),
    agent('s', 'general-purpose', undefined, 'Audit payment handling', 'running', 'security-reviewer'),
    agent('p', 'Explore', undefined, 'Profile slow queries', 'running', 'perf-profiler'),
    agent('l', 'general-purpose', undefined, 'Fix lint warnings', 'running', 'lint-fixer'),
  ],
  loops: {
    ...TEAM.loops,
    m: { model: 'claude-opus-5-5', tokens: 88_000, sent: 96_300, received: 9_200, activity: 'Read db/schema.sql' },
    d: { model: 'claude-sonnet-5-5', tokens: 30_000, sent: 28_700, received: 5_400, activity: 'Edit docs/api.md' },
    s: { model: 'claude-sonnet-5-5', tokens: 160_000, sent: 141_000, received: 6_800, activity: 'Grep "charge(" in src' },
    p: { model: 'claude-haiku-5-5', tokens: 22_000, sent: 19_800, received: 1_300, activity: 'Bash: npm run bench' },
    l: { model: 'claude-haiku-5-5', tokens: 12_000, sent: 11_400, received: 900, activity: 'Bash: npm run lint' },
  },
  // The band's own rows, less the blank row above it, as the plugin counts them.
  maxRows: 11,
}

// What the usage endpoint reports for the month: spent, and the limit, or none.
const MONTH = { spent: 1082.62, currency: 'USD', resetsAt: '2026-11-01T00:00:00Z' }

const ORGANISATION = {
  limits: [],
  planSplit: {},
  sessionTokens: { opus: 210_000, sonnet: 80_000 },
  usd: 18.4,
  main: { ...MAIN, tokens: 52_000, sent: 196_000, received: 14_000, activity: 'Read infra/main.tf' },
}

// The README shows the first four at the top, in this order, and the rest further down.
const SCREENS = [
  {
    file: 'initial.png',
    title: 'A new session, before the first reply',
    above: '',
    v: view({ limits: [], planSplit: {}, sessionTokens: {}, usd: 0, main: { model: MAIN.model, window: MAIN.window } }),
  },
  { file: 'band.png', title: 'Pro or Max, with more agents than the band has room for', v: view(CROWD) },
  {
    file: 'enterprise.png',
    title: 'Enterprise with a spend limit',
    v: view({ ...ORGANISATION, ...CROWD, spend: { ...MONTH, limit: 2000, percentUsed: 54.1 } }),
  },
  {
    file: 'unlimited.png',
    title: 'Enterprise with no spend limit',
    v: view({ ...ORGANISATION, ...CROWD, spend: { ...MONTH, limit: null, percentUsed: null } }),
  },
  {
    file: 'limit.png',
    title: 'Near the limit',
    v: view({
      limits: [
        { kind: 'five_hour', percentUsed: 93, resetsAt: at(41) },
        { kind: 'seven_day', percentUsed: 71, resetsAt: at(1620) },
      ],
      main: { ...MAIN, tokens: 151_000, sent: 318_600, received: 18_400, activity: 'Bash: npm test' },
    }),
  },
  {
    file: 'extra.png',
    title: 'Pro or Max with extra usage turned on',
    v: view({ ...TEAM, spend: { ...MONTH, spent: 12.3, limit: 50, percentUsed: 24.6 } }),
  },
  {
    file: 'no-limit.png',
    title: 'An API key: no limit reported',
    v: view({ ...ORGANISATION, ...TEAM, isUnlimited: true }),
  },
  { file: 'collapsed.png', title: 'Collapsed with /canopy', v: view({ ...TEAM, isCollapsed: true }) },
  { file: 'narrow.png', title: 'A narrow terminal (60 columns)', v: view({ ...TEAM, width: 60 }) },
  {
    file: 'agents-only.png',
    title: '/canopy set plan off · /canopy set session off',
    v: view({ ...TEAM, settings: settingsFrom({ plan: false, session: false }) }),
  },
  { file: 'no-agents.png', title: '/canopy set agents off', v: view({ settings: settingsFrom({ agents: false }) }) },
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

function page({ title, v, above }) {
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
  .band { position:relative; padding:0 0 8px } .mark { position:absolute; right:0; top:1.55em; line-height:1.55; color:var(--dim) }
  .prompt { border:1px solid #4a505c; border-radius:7px; padding:4px 10px; margin-top:6px }
  .caret { background:var(--fg); color:transparent } .dim { color:var(--dim) }
  </style>
  <div class="term"><div class="bar"><span class="dot" style="background:#f87171"></span><span class="dot" style="background:#fbbf24"></span><span class="dot" style="background:#4ade80"></span><span class="t">${esc(title)}</span></div>
  <div class="screen">${[
    above === '' ? '' : `<div class="dim">⏺ ${esc(above ?? (v.roster.length ? `Launched ${v.roster.length} agents` : 'Updated src/routes/orders.ts'))}</div>`,
    // The plugin leaves a blank row above the band.
    `<div class="band"><div class="row">&nbsp;</div>${lines.map(l => `<div class="row">${lineHtml(l)}</div>`).join('')}<span class="mark">${v.isCollapsed ? '[+]' : '[-]'}</span></div>`,
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
  console.log(join(out, screen.file))
}
await browser.close()
