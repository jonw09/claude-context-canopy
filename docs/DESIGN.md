# Context Canopy: design notes

How the plugin works, why it works that way, and how to release it. For using it, see the [README](../README.md), and for what it reads, sends and keeps, [PRIVACY.md](../PRIVACY.md).

## How it fits together

```
Claude Code events                  state ($.state)             drawing
──────────────────                  ───────────────             ───────
session.start / session.measure ─→  limits, main, usd,    ─┐
$.session.usage() every second      sessionAt              │
turn.step (every model request) ─→  sessionTokens,         │
                                    loops[agent].tokens,   ├─→ layout.ts ─→ ui.render(AbovePrompt)
                                    sent, received         │
tool.call / turn.start / complete ─→ loops[agent].activity │   buildLines()    └─ /canopy show (text)
$.agent.list() every second     ─→  roster                 │
$.session.model() every second  ─→  main.model             │
usage endpoint, $.http.fetch    ─→  spend                 ─┘
turn.step ─→ hourly log ($.store) ─→ planSplit (≈ estimate)
session figures ─→ sessions ($.store) ─→ resume
```

| File | Job |
| --- | --- |
| `hooks/register.tsx` | Event collectors, the spend request, the `/canopy` command and the `ui.render` hook. The only file that talks to the engine. |
| `hooks/layout.ts` | Turns state into coloured lines for a given width. Pure. |
| `hooks/tree.ts` | Nests the flat agent list by `parentId`, drops finished agents, lifts orphans. Pure. |
| `hooks/format.ts` | Token counts, money, durations, clipping, tool descriptions. Pure. |
| `hooks/palette.ts` | Model families, labels and colours; health against the compaction point. Pure. |
| `hooks/estimate.ts` | Token weighting, the hourly per-model log and each window's split, and the saved sessions. Pure. |
| `hooks/spend.ts` | Reads the spend out of the usage endpoint's reply, and when the month ends. Pure. |
| `hooks/settings.ts` | `/canopy set` overrides to settings, with red kept above amber. Pure. |
| `types/index.d.ts` | The `$.state` contract. |
| `scripts/render-images.mjs` | Redraws the README screenshots from `layout.ts`. Not part of the plugin. |

Every hook observes and calls `next(e)` unchanged. Work after `next` is wrapped so a failure in the band never affects a tool call, an agent spawn or a model request.

## Where the data comes from

Checked against the Claude Code 2.1.309 plugin API.

| Need | Source | Notes |
| --- | --- | --- |
| Plan windows | `$.session.usage().rateLimits`, pushed by `session.measure` | `{ kind, percentUsed, resetsAt }`. Kinds: `five_hour`, `seven_day`, a gateway's `spend_limit`. Empty off a subscription. |
| Session cost | `$.session.usage().cost.usd` | Total only, as `/cost` has it, at API prices. |
| The month's spend | `GET https://api.anthropic.com/api/oauth/usage`, through `$.http.fetch` with the handle `$.session.authorize()` gives | The request behind Claude Code's `/usage`. Its `extra_usage` holds `used_credits` and `monthly_limit` (minor units of `currency`, the limit null when there is none), `utilization` (0 to 100) and `is_enabled`. The host adds the login itself, for Anthropic's hosts only, so the plugin never holds it. A `bearer` handle only: an API key, gateway or cloud provider gets none. Asked at the start, every five minutes, and after a main turn ends at most once a minute; a failed read keeps the last one. Claude Code resets it on the 1st of next month, local time, and so does the band. `/canopy set spend off` stops it. |
| Session start | `$.session.usage().startedAt` | Keys the session's figures. Claude Code restores a resumed session's cost and resets it on `/clear`, which starts a new session; the band does the same with its tokens, saving each session's tokens in `$.store` (`sessions`, 40 days) and picking them up again on a resume. Main's sent and received counts start over. `/clear` raises no measure event, so the one-second poll also reads `$.session.usage()` (free) and measures again when the start time or cost moves. |
| Main context | `$.session.usage().context` | `tokens`, `window`. The compaction point comes from `breakdown: 'summary'` (a local estimate, no API calls), asked for again only when the window changes. |
| Per-request model and tokens | `turn.step` result `usage`, with `e.agentId` | Fires for main and every subagent. Each agent's sent (input, cache writes, cache reads at a tenth) and received (output) add up across its requests. |
| Band height | `ui.render` `props.maxRows` | The rows the band may take. Past it the engine scrolls the band, so the plugin cuts the tree itself first. |
| Agent tree | `$.agent.list()` | `id`, `parentId`, `type`, `name`, `description`, `status`. |
| Agent's model | `turn.step` and `agent.spawn` results | Not on the agent list. |
| Main model | `$.session.model()`, at the start and each second | So the main row names its model before the first request, and follows a `/model` switch. Between switches, the model of the last request stands, so a fallback shows. |
| What an agent is doing | `tool.call` (tool name and input at the top level of `e`) | Cleared on `turn.complete`. |

### What the API doesn't give, and what the plugin does instead

- **Windows as reported.** Plans report 5-hour and 7-day windows, and nothing daily. The plan line draws whatever windows arrive, so new kinds appear without an update.
- **No per-model split of plan usage.** The plugin keeps an hourly per-model log in `$.store` and splits each window by the hours inside it. Marked `≈`. It sees only this machine.
- **No per-model cost.** The session line splits by tokens instead.
- **No subagent window size.** 200k by default, 1M for `[1m]` models, or the main session's window when the model matches. Each agent's compaction point is its window scaled by the main session's compaction ratio.
- **Teammates in their own terminal pane** run no loop in this process: status only, `—` for context.
- **No plan name.** Claude Code doesn't tell plugins which plan you're on, so the row is headed **Plan Limits**. `$.session.identity()` gives the organisation's plan, but only to mods that organisation-managed settings install, and the directory reviews it as a credential read, so the plugin doesn't call it. The login file on disk was left alone too: it is undocumented, varies by platform and sits beside credentials.
- **No spend in the plugin API.** `$.session.usage()` has no figure for what an account has spent this month. A gateway's `spend_limit` window comes as a percentage (past 100 once exceeded) and a reset time only. So the plugin makes the request `/usage` makes, as above. It's not a published API, so `spendFrom` reads it defensively: anything it can't read shows no spend rather than a wrong one. An earlier version added up this machine's saved sessions instead, which on a new install or a fresh container came to the session alone, and never saw other devices.
- **The spend row.** Laid out as the session line is: the amount in the model column, then a gauge and percentage of the limit, and `of $2,000` as the detail; with no limit, `unlimited` where the gauge would be. Headed `month`, as Claude Code calls it, or `extra` beside the 5-hour and 7-day windows, where it is extra usage on top of them.
- **No word of an unlimited seat without a login.** With no spend read and no window reported (an API key, a cloud provider, a gateway with no limit, or the request failing), once Claude has replied, and with no window seen this session (a window can lapse unread), the plan line shows `month` reading `unlimited` alone. `$.session.identity()` would tell these apart, but only to mods that an organisation's managed settings install.
- **No session limit.** A session has no limit of its own, so the band shows its cost alone, on the session line, for every plan.
- **The mobile app on a cloud session attaches no drawing surface.** `$.session.surfaces()` is empty there, so nothing a plugin draws appears. `/canopy show` prints the band as text for that case.

## Display decisions

- **Always shown.** Plan and session usage matter even with no agents running.
- **Session, Plan, then Agents**, one blank row above the band (counted against `maxRows`). The collapsed line keeps the same order.
- **Two colour sets that never overlap.** Model colours (hex, chosen to read on light and dark terminals): Fable `#a78bfa`, Opus `#e879f9`, Sonnet `#60a5fa`, Haiku `#22d3ee`, other `#9ca3af`. Health uses the theme keys `success`, `warning` and `error`, so it follows the user's theme, colour-blind ones included.
- **A bar always means how full something is.** Plan windows, the spend limit and each agent's context are gauges, coloured by health alone, with the percentage beside them in the same colour. Model colours never fill a bar: they mark model names and the `■` shares in the legends. The session line has no limit, so it has no bar: an earlier strip of model shares there looked like a gauge and repeated its own legend. The plan windows used to be filled in model colours, which made a window's bar and an agent's context bar mean different things in one column.
- **Health is tied to the auto-compact point.** Amber from 60% of the way there, red from 90%. Both can be changed with `/canopy set`. The percentage printed is of the full window, to match `/context`.
- **Plan percentages** use the same 60% and 90% points against the window's 100%.
- **Any figure above nothing fills a cell** of its bar, so a month 2% used still shows.
- **Finished agents drop off** at once. Their running children move up to the nearest live ancestor.
- **"Waiting on N agents"** counts direct helpers only. Deeper ones show under the agent that started them.
- **One grid for every row.** Label, key, model, bar, percentage, then detail (legend or activity), so bars, percentages and details line up down the band. Money goes in the model column, so the session's cost and the month's spend sit one above the other. The key column widens for a long window name or reset time, and from 120 columns for long agent names, up to 30 columns (half as much again). It always keeps a blank column before the model.
- **The detail column opens with a two-cell gutter** for a sign: `≈` on an estimated split, `⚠` on an agent near compaction. Legends and each agent's `↑ sent ↓ received` counts start after it, in one column, and the agents' activity after the counts.
- **Main counts from nothing**; another agent shows no counts until its first request, so teammates in their own pane, whose usage this session can't see, show none.
- **Each model keeps one slot in every legend**, sized to its name and a right-aligned percentage, so `■ Sonnet` sits in the same column on every row. A row that lacks a model leaves its slot blank. Models drop from the right when the room runs out.
- **Narrow layouts** (under 72 columns) drop the bars and token counts, shorten model names, and drop the pence from $1,000 so an amount fits its column. Legends and activity take what room is left, item by item.
- **Tall trees are cut to fit** `maxRows`, less the rows the margin, session and plan take, keeping main. The last row says how many agents it hides, and how many of those are near compacting. `/canopy show` has no height, so it prints the whole tree.

## Testing

From a clone of the repository:

```
claude --plugin-dir .             # run it from this folder
claude plugin validate --strict . # check the manifest and hooks module
claude plugin test .              # run the tests
```

- `tests/helpers.test.ts`: tree, format, palette, estimate (the usage log and saved sessions), reading the spend from the usage endpoint's reply, and settings.
- `tests/layout.test.ts`: every band state, each kind of plan, a tree cut to fit, and every width from 40 to 160 columns.
- `tests/band.test.tsx`: the band drawn through the engine on terminal and desktop, its margin and cut tree, `/canopy` and its subcommands, model requests feeding the band, the main model, `/clear` and resume, and the spend request: what it asks and with which login, its timer, a failed read, `/canopy set spend off`, and no request without a login.

For a type-check, use the `tsconfig.json` in the repo once Claude Code has loaded the plugin from this folder (it writes the API types to `.claude-plugin/types/`), then run `tsc -p .`.

The README screenshots in `docs/images/` are drawn from `layout.ts`'s output by `node scripts/render-images.mjs` (it needs `typescript` and `playwright` installed globally, and the JetBrains Mono font). Run it when the layout changes. `node scripts/render-images.mjs <folder>` writes to another folder instead, to compare before copying over. The script is for this repo only: Claude Code never runs it.

### Not yet covered

- A live run on Pro, Max, a gateway spend limit, Enterprise with and without a spend limit, and an API key, and in the desktop app. The spend request in particular was built from the shape Claude Code 2.1.309 reads, not a live reply.
- Saving the usage log and session figures across sessions (`flush` on the timer, at session end and on a change of session). Up to a minute of either can be lost if Claude Code exits abruptly.

## Releasing

Releases are made by [Release Please](https://github.com/googleapis/release-please). `main` only changes through squash-merged pull requests, and each pull request's title becomes the commit message that Release Please reads, so titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat: …` for something new, `fix: …` for a bug fix, and `docs:`, `ci:`, `chore:`, `test:`, `refactor:` and so on for the rest. `release-please-config.json` lists every type under `changelog-sections`, so every merged pull request appears in the changelog under its type's heading.

### One-time setup

GitHub doesn't run CI on pull requests opened by a workflow's own token, and the branch rule needs CI to pass, so Release Please uses a token of yours instead.

1. Create a fine-grained token at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   - **Token name:** `Release Please (claude-context-canopy)`
   - **Expiration:** up to a year. Note the date, as releases stop until it's renewed.
   - **Repository access:** Only select repositories → `jonw09/claude-context-canopy`
   - **Repository permissions:** Contents, Issues and Pull requests, each **Read and write**. Metadata turns on by itself.
2. Copy the token, then add it to this repo under Settings → Secrets and variables → Actions → **New repository secret**, named `RELEASE_PLEASE_TOKEN`.

Without the secret, Release Please still runs with the workflow's own token, but CI won't run on its pull request, so the branch rule blocks the merge. Adding the secret and pushing to the release branch again (or closing and reopening the pull request) fixes that.

### Each release

1. Merge pull requests as normal. After each merge to `main`, `.github/workflows/release.yml` opens or updates a pull request titled `chore(main): release <version>`. It sets the version in `.claude-plugin/plugin.json` and adds the changes to `CHANGELOG.md`.
2. When you're ready to release, run the live check above with `claude --plugin-dir .` on `main`, then merge the release pull request once CI passes.
3. Release Please tags the merge `v<version>` and publishes a GitHub release with the same notes.
4. The listing in `jonw09/claude-plugins` points at this repo, so it picks up the release with no change there. People get it by updating the marketplace they installed from (`jonw09` or `claude-context-canopy`) with `claude plugin marketplace update`, then running `claude plugin update context-canopy`.

How the version moves while it's below 1.0: `feat` raises the minor version (0.1.0 → 0.2.0), any other type raises the patch (0.1.0 → 0.1.1), and a breaking change (`feat!:`) also raises the minor version. To pick a version yourself, put `Release-As: 1.0.0` on its own line in a merged pull request's description.

To word a changelog entry differently from the pull request title, add this to the pull request's description before merging, with one entry per paragraph:

```
BEGIN_COMMIT_OVERRIDE
feat: the wording you want

fix: another entry
END_COMMIT_OVERRIDE
```

### Plugin directory

To list it in Anthropic's plugin directory, submit this repository (not the `claude-plugins` catalogue, whose entry points here) at [claude.ai/directory/manage](https://claude.ai/directory/manage). The portal follows `main`, so new commits are scanned without a new submission. It takes the plugin's icon only on the first submission.

Some findings are expected and go to a reviewer rather than blocking: `scripts/render-images.mjs` names the screenshots it writes, and `.github/workflows/release.yml` reads the Release Please token. Neither runs when someone uses the plugin. The spend request (`$.session.authorize()` with `$.http.fetch`) may be reviewed too: it goes to Anthropic alone, the host holds the login, and [PRIVACY.md](../PRIVACY.md) and the manifest's `privacyPolicyUrl` say so.
