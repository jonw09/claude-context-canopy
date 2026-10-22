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
- **No plan name.** `$.session.identity()` answers only mods that organisation-managed settings install, and then gives `organizationType` (`claude_team`, `claude_enterprise`). Everyone else sees **Plan Limits**. The login file on disk was considered and left alone: it is undocumented, varies by platform and sits beside credentials.
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

```
claude plugin validate .
claude plugin test .
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

`main` only changes through pull requests. CI (`.github/workflows/ci.yml`) validates the plugin and runs the tests on every one, and `.github/rulesets/main.json` is the branch rule to import in GitHub (Settings → Rules → Rulesets → New ruleset → Import a ruleset).

1. On a branch, set the version in `.claude-plugin/plugin.json` and turn the `(unreleased)` heading in `CHANGELOG.md` into the version and date, such as `## 0.1.0 (2026-11-02)`. Open a pull request and merge it once CI passes.
2. Pull `main` and run the live check above with `claude --plugin-dir .`.
3. Run `claude plugin tag . --push`. It checks `plugin.json` and the marketplace entry agree, then pushes the tag `context-canopy--v<version>`.
4. The tag starts `.github/workflows/release.yml`, which checks the tag matches `plugin.json` and the changelog entry is dated, runs the checks again, and publishes a GitHub release with that version's notes.
5. The listing in `jonw09/claude-plugins` points at this repo, so it picks up the release with no change there.
6. **Private repo:** only people you invite can install, and their machine needs a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).
7. **Going public:** GitHub → Settings → General → Danger Zone → Change visibility. Nothing in the repo needs to change.
8. **Anthropic's plugin directory:** once public, submit through the developer portal (see the Claude Code plugin docs). Run `claude plugin validate . --profile directory` first. The directory takes the icon (`.claude-plugin/icon.png`) only on the first submission.
