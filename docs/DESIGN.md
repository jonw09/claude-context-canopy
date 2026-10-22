# Context Canopy: design notes

How the plugin works, why it works that way, and how to release it. For using it, see the [README](../README.md). [preview.html](preview.html) has design mock-ups of every state.

## How it fits together

```
Claude Code events                  state ($.state)             drawing
──────────────────                  ───────────────             ───────
session.start / session.measure ─→  limits, main, usd     ─┐
turn.step (every model request) ─→  sessionTokens,         │
                                    loops[agent].tokens    ├─→ layout.ts ─→ ui.render(AbovePrompt)
tool.call / turn.start / complete ─→ loops[agent].activity │   buildLines()    └─ /canopy show (text)
$.agent.list() every second     ─→  roster                ─┘
turn.step ─→ hourly log ($.store) ─→ planSplit (≈ estimate)
```

| File | Job |
| --- | --- |
| `hooks/register.tsx` | Event collectors, the `/canopy` command and the `ui.render` hook. The only file that talks to the engine. |
| `hooks/layout.ts` | Turns state into coloured lines for a given width. Pure. |
| `hooks/tree.ts` | Nests the flat agent list by `parentId`, drops finished agents, lifts orphans. Pure. |
| `hooks/format.ts` | Token counts, durations, clipping, tool descriptions. Pure. |
| `hooks/palette.ts` | Model families, labels and colours; health against the compaction point. Pure. |
| `hooks/estimate.ts` | The hourly per-model log and each window's split. Pure. |
| `hooks/settings.ts` | `/canopy set` overrides to settings, with red kept above amber, and the organisation's plan name. Pure. |
| `types/index.d.ts` | The `$.state` contract. |

Every hook observes and calls `next(e)` unchanged. Work after `next` is wrapped so a failure in the band never affects a tool call, an agent spawn or a model request.

## Where the data comes from

Checked against the Claude Code 2.1.306 plugin API.

| Need | Source | Notes |
| --- | --- | --- |
| Plan windows | `$.session.usage().rateLimits`, pushed by `session.measure` | `{ kind, percentUsed, resetsAt }`. Kinds: `five_hour`, `seven_day`, a gateway's `spend_limit`. Empty off a subscription. |
| Session cost | `$.session.usage().cost.usd` | Total only. |
| Main context | `$.session.usage().context` | `tokens`, `window`. The compaction point comes from `breakdown: 'summary'` (a local estimate, no API calls), asked for again only when the window changes. |
| Per-request model and tokens | `turn.step` result `usage`, with `e.agentId` | Fires for main and every subagent. |
| Agent tree | `$.agent.list()` | `id`, `parentId`, `type`, `name`, `description`, `status`. |
| Agent's model | `turn.step` and `agent.spawn` results | Not on the agent list. |
| What an agent is doing | `tool.call` (tool name and input at the top level of `e`) | Cleared on `turn.complete`. |

### What the API doesn't give, and what the plugin does instead

- **No daily or monthly window.** Plans report 5-hour and 7-day windows. The plan line draws whatever windows arrive, so new kinds appear without an update.
- **No per-model split of plan usage.** The plugin keeps an hourly per-model log in `$.store` and splits each window by the hours inside it. Marked `≈`. It sees only this machine.
- **No per-model cost.** The session line splits by tokens instead.
- **No subagent window size.** 200k by default, 1M for `[1m]` models, or the main session's window when the model matches. Each agent's compaction point is its window scaled by the main session's compaction ratio.
- **Teammates in their own terminal pane** run no loop in this process: status only, `—` for context.
- **No plan name.** Claude Code doesn't tell plugins which plan you're on, so the row is headed **Plan Limits**. `$.session.identity()` gives the organisation's plan, but only to mods that organisation-managed settings install, and the directory reviews it as a credential read, so the plugin doesn't call it. The login file on disk was left alone too: it is undocumented, varies by platform and sits beside credentials.
- **No dollar figures for spend limits.** A `spend_limit` window comes as a percentage and a reset time only.
- **The mobile app on a cloud session attaches no drawing surface.** `$.session.surfaces()` is empty there, so nothing a plugin draws appears. `/canopy show` prints the band as text for that case.

## Display decisions

- **Always shown.** Plan and session usage matter even with no agents running.
- **Two colour sets that never overlap.** Model colours (hex, chosen to read on light and dark terminals): Fable `#a78bfa`, Opus `#e879f9`, Sonnet `#60a5fa`, Haiku `#22d3ee`, other `#9ca3af`. Health uses the theme keys `success`, `warning` and `error`, so it follows the user's theme, colour-blind ones included.
- **Health is tied to the auto-compact point.** Amber from 60% of the way there, red from 90%. Both can be changed with `/canopy set`. The percentage printed is of the full window, to match `/context`.
- **Plan percentages** use the same 60% and 90% points against the window's 100%.
- **Finished agents drop off** at once. Their running children move up to the nearest live ancestor.
- **"Waiting on N agents"** counts direct helpers only. Deeper ones show under the agent that started them.
- **One grid for every row.** Label, key, model, bar, percentage, then detail (legend or activity), so bars, percentages and details line up down the band. The key column widens for a long window name, the label column for a long plan name.
- **Narrow layouts** (under 72 columns) drop the bars and shorten model names. Legends and activity take what room is left, item by item.
- **Tall trees** are left to the engine, which scrolls the band within `maxRows`.

## Testing

From a clone of the repository:

```
claude --plugin-dir .             # run it from this folder
claude plugin validate --strict . # check the manifest and hooks module
claude plugin test .              # run the tests
```

- `tests/helpers.test.ts`: tree, format, palette, estimate and settings.
- `tests/layout.test.ts`: every band state, and every width from 40 to 160 columns.
- `tests/band.test.tsx`: the band drawn through the engine on terminal and desktop, `/canopy` and its subcommands, and model requests feeding the band.

For a type-check, use the `tsconfig.json` in the repo once Claude Code has loaded the plugin from this folder (it writes the API types to `.claude-plugin/types/`), then run `tsc -p .`.

`node scripts/render-images.mjs` redraws the README screenshots from `layout.ts`, so they always match what the plugin draws.

### Not yet covered

- A live run on Pro, Max and API key sessions, and in the desktop app.
- Saving the usage log across sessions (`flush` on the timer and at session end). Up to a minute of the log can be lost if Claude Code exits abruptly.

## Releasing

Releases are made by [Release Please](https://github.com/googleapis/release-please). `main` only changes through squash-merged pull requests, and each pull request's title becomes the commit message that Release Please reads, so titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat: …` for something new, `fix: …` for a bug fix, and `docs:`, `ci:`, `chore:` or `test:` for anything that shouldn't be in the changelog.

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
4. The listing in `jonw09/claude-plugins` points at this repo, so it picks up the release with no change there. People get it with `claude plugin marketplace update`, then `claude plugin update context-canopy`.

How the version moves while it's below 1.0: `feat` raises the minor version (0.1.0 → 0.2.0), `fix` raises the patch (0.1.0 → 0.1.1), and a breaking change (`feat!:`) also raises the minor version. To pick a version yourself, put `Release-As: 1.0.0` on its own line in a merged pull request's description.

To word a changelog entry differently from the pull request title, add this to the pull request's description before merging, with one entry per paragraph:

```
BEGIN_COMMIT_OVERRIDE
feat: the wording you want

fix: another entry
END_COMMIT_OVERRIDE
```

### Plugin directory

To list it in Anthropic's plugin directory, submit this repository (not the `claude-plugins` catalogue, whose entry points here) at [claude.ai/directory/manage](https://claude.ai/directory/manage). The portal follows `main`, so new commits are scanned without a new submission. It takes the plugin's icon only on the first submission.

Some findings are expected and go to a reviewer rather than blocking: `scripts/render-images.mjs` names the screenshots it writes, and `.github/workflows/release.yml` reads the Release Please token. Neither runs when someone uses the plugin.
