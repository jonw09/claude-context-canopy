<div align="center">

![Context Canopy icon](docs/images/icon.svg)

# Context Canopy

Your session, plan limits and every running agent, in one band above the Claude Code prompt.

</div>

**A new session.** Your model shows straight away. Plan limits appear after Claude's first reply.

![A new session before the first reply: no tokens yet, the plan line waiting for the first reply, and main on Opus 5.5, ready](docs/images/initial.png)

**Pro or Max.** The session by model, the 5-hour and 7-day windows, and every agent's context, tokens and current step. A tree taller than the band has room for ends with a row saying how many agents it hides.

![The band on Pro or Max: the session by model, 5h and 7d windows, and a tree of agents cut to fit, ending with 3 more agents, 1 of them near compacting](docs/images/band.png)

**Enterprise with a spend limit.** How much of your monthly spend limit is used and when it resets, with the session's cost on the session line.

![The band with a spend limit: the session at $18.40, the month at 64% resetting in 9 days, and a tree of agents cut to fit](docs/images/enterprise.png)

**Enterprise with no spend limit.** About what this machine has spent this month, reading `unlimited`.

![The band with no spend limit: the session at $18.40, the month at about $412.80 reading unlimited, and a tree of agents cut to fit](docs/images/unlimited.png)

## What it shows

| Line | What you see |
| --- | --- |
| **Session** | Tokens and cost for this session, split by model |
| **Plan** | Your plan's limits: how full each is, when it resets, and an estimate of which models used it. On Pro and Max that's the 5-hour and 7-day windows, and with a spend limit, the month. With no limit, about what you've spent this month |
| **Agents** | Every running agent as a tree, however deep: its model, how full its context is, the tokens it has sent and received, and what it is doing right now |

Each model keeps one colour everywhere: **Fable** violet, **Opus** magenta, **Sonnet** blue, **Haiku** cyan. Green, amber and red are kept for one job only: how full something is.

## Install

You need Claude Code 2.1.309 or newer. There are two ways to install it. Pick one only: installing both shows two bands.

### Option 1: through my plugin marketplace (recommended)

Adds [jonw09/claude-plugins](https://github.com/jonw09/claude-plugins), then installs Context Canopy from it. My other plugins then show up in your plugin browser, ready to install if you want them. Nothing else is installed.

**In Claude Code** (at the prompt of a terminal session), run these one at a time:

```
/plugin marketplace add jonw09/claude-plugins
/plugin install context-canopy@jonw09
```

**From a shell:**

```
claude plugin install context-canopy --marketplace jonw09/claude-plugins
```

**In the desktop app:** click **+** next to the prompt box, choose **Plugins**, then **Add marketplace** and enter `jonw09/claude-plugins`, then **Add plugin**.

### Option 2: on its own

Installs Context Canopy straight from this repo, for when it's the only plugin of mine you want.

**In Claude Code:**

```
/plugin marketplace add jonw09/claude-context-canopy
/plugin install context-canopy@claude-context-canopy
```

**From a shell:**

```
claude plugin install context-canopy --marketplace jonw09/claude-context-canopy
```

**In the desktop app:** as above, but enter `jonw09/claude-context-canopy` as the marketplace.

When asked, press Enter to install for your user. The band appears straight away.

## Try it

Once installed, ask Claude for something that uses a few agents:

> explore this repo with three parallel agents

Watch the tree grow under `main`, each agent's context bar fill, and its current step change as it works. Agents drop off the tree the moment they finish.

## Reading the band

The band sits one blank row above the prompt box, with the session first, then the plan, then the agents.

### Session

Total tokens and cost for this session, with a bar and percentages split by model. These follow Claude Code's own session cost:

- **Resuming a session** brings back its cost, and the tokens this machine saw it use.
- **`/clear`** starts a new session, so the cost and tokens start over.

The cost is Claude Code's own figure, as `/cost` shows it, worked out at API prices. On Pro and Max, that's what the session would have cost through the API, not what you pay.

### Plan

![Plan line near the limit: the 5-hour window at 93% in red and the 7-day window at 71% in amber](docs/images/limit.png)

- The bar shows how full the window is, coloured by the models that used it.
- The percentage turns **amber from 60%** and **red from 90%**. You can move both with [`/canopy set`](#settings).
- `↻ 41m` is the time until the window resets. A full window reads `limited`.
- `≈` marks the model split as an estimate (see [Good to know](#good-to-know)).

The plan line appears after Claude's first reply, when your limits are first reported.

**The row's name.** Claude Code doesn't tell plugins which plan you're on, so the row is headed **Plan Limits**.

**Team, Enterprise and API keys.** What the line shows depends on what Claude reports for your account:

| Account | What the plan line shows |
| --- | --- |
| Pro, Max, Team seats with usage limits | The 5-hour and 7-day windows |
| A spend limit (organisations using a Claude gateway) | `month`: how much of your monthly spend limit is used, and when it resets |
| No limit reported (Enterprise with no spend limit, an uncapped seat, an API key or a cloud provider) | `month`: about what this machine has spent this month, reading `unlimited` |

**With a spend limit**, Claude reports the month as a percentage only, so the band can't show the dollar amount of your limit or of what you've spent. The month can go past 100%, and reads `limited` when it does.

**With no limit:**

- Claude reports no limit at all, so the band can't tell an Enterprise seat with no spend limit from an API key or a cloud provider. All of them read `unlimited`.
- The month, marked `≈`, adds up the sessions this machine has seen since the 1st of the month, by what each had cost when last seen. It can't see claude.ai or your other devices.

### Agents

Each row shows:

```
├─● reviewer        Sonnet 5.5  ▆▆▆▆▆▆▆▆▆▆▆▆  59%     ↑112k  ↓6k    Read billing/invoice.ts
│ │                 │           │             │       │             └ what it is doing now
│ │                 │           │             │       └ tokens sent ↑ and received ↓
│ │                 │           │             └ context used, of the full window
│ │                 │           └ context bar, coloured by health
│ │                 └ model, in its colour
│ └ status: ● running  ◐ waiting  ◌ starting  ○ idle
└ tree guides showing who started whom
```

The tokens are counted the same way as the session line, so all the agents add up to the session's total. Main counts from the start of the session, and every other agent from its first request.

Context colours are tied to the point where Claude Code **auto-compacts** the conversation, not to the raw window size:

| Colour | When | What to do |
| --- | --- | --- |
| 🟩 Green | under 60% of the way to auto-compact | nothing |
| 🟨 Amber | 60% to 89% of the way | long contexts start to lose quality from here |
| 🟥 Red, `⚠ compacts soon` | 90% of the way or more | consider `/compact`, or let it happen |

These are the same 60% and 90% points as the plan line, and [`/canopy set`](#settings) moves them for both.

The main row names your model from the start, and changes as soon as you switch with `/model`. If a request falls back to another model, the row shows the one that answered.

**A tall tree** is cut to fit the room Claude Code gives the band, and ends with a row such as `+3 more agents`, adding `⚠ 1 compacts soon` if any of the hidden agents are near compacting. `/canopy show` prints the whole tree.

**Long agent names** get up to half as much room again in a terminal 120 columns or wider, before they're cut.

## Commands

| Command | What it does |
| --- | --- |
| `/canopy` | Collapse the band to one line, or expand it again |
| `/canopy collapse` / `/canopy expand` | Set it one way |
| `/canopy show` | Print the band as text (for places that can't draw it, see below) |
| `/canopy show 80` | The same, at a set width |
| `/canopy status` | Check whether the band can be drawn here, and show any error |
| `/canopy set …` | Change a setting (see [Settings](#settings)) |
| `/canopy reset` | Put every setting back to its default |

![The collapsed band: one line with session totals, plan percentages, the agent count, one agent needing compaction and main at 37%](docs/images/collapsed.png)

In a narrow terminal the band drops the bars and token counts, shortens model names and keeps every percentage in its column:

![The band in a 60-column terminal, without bars, with percentages still in one column](docs/images/narrow.png)

## Settings

There's nothing to set up: the defaults suit most people. To change one, use `/canopy set`. Changes apply straight away and are kept for later sessions.

| Command | Default | What it does |
| --- | --- | --- |
| `/canopy set amber 70` | 60 | Turn amber from this %: of a plan window used, or of the way to auto-compact for context |
| `/canopy set red 95` | 90 | Turn red from this %, measured the same way |
| `/canopy set plan off` | on | The plan line |
| `/canopy set session off` | on | The session line |
| `/canopy set agents off` | on | The agent tree |
| `/canopy set split off` | on | The `≈` model split on the plan line |

For example, to keep only the agent tree:

```
/canopy set plan off
/canopy set session off
```

![The band with the plan and session lines off: only the agent tree](docs/images/agents-only.png)

Or to keep the session and plan lines, without the tree:

```
/canopy set agents off
```

![The band with the agent tree off: the session and plan lines only](docs/images/no-agents.png)

## Where it works

| Where | Band | `/canopy show` |
| --- | --- | --- |
| Claude Code in a terminal | ✅ | ✅ |
| Claude desktop app (Code tab) | ✅ | ✅ |
| Claude mobile app or web, viewing a cloud session | ❌ the app doesn't draw plugin bands | ✅ |

If the band doesn't appear, run `/canopy status`. It lists which apps are attached and whether any of them asked for the band.

## Good to know

- **The plan model split is an estimate.** Claude reports one percentage per window, not a split by model. Context Canopy logs the usage it sees on this machine and splits each window by that. It can't see claude.ai or your other devices.
- **How tokens are counted.** Fresh input, output and cache writes count in full. Cache reads count at a tenth, which is how they're priced, so the totals reflect real usage rather than the same context re-read on every request. Each agent's ↑ sent and ↓ received counts work the same way.
- **Subagent windows.** Agents get a 200k context window, or 1M for `[1m]` models, unless they run on the same model as the main session.
- **Teammates in their own pane** show in the tree with `—` for context, because their usage isn't visible to this session.
- **Claude Code updates.** Context Canopy uses Claude Code's plugin API, which is still in early access, so a Claude Code update can occasionally break the band. If it disappears, run `/canopy status`, update the plugin, and [report a problem](https://github.com/jonw09/claude-context-canopy/issues) if that doesn't fix it.

## Privacy

Context Canopy only reads, and nothing leaves your machine. It makes no network requests, calls no model and sends nothing anywhere.

- **What it reads:** this session's model, token counts, cost and rate-limit windows, the list of running agents, and the apps attached to the session (for `/canopy status`). As Claude works, it reads each agent's model and token counts and the tool each one calls, with that tool's main argument (a file path, search pattern or shell command), to show what each agent is doing. That activity is held in memory for the session only and is never saved.
- **What it stores:** an hourly count of tokens per model family, for the `≈` split; each session's cost and tokens per model family, keyed by when the session started, so a resumed session picks them up again and the month can be added up; and your `/canopy set` choices. All of it is numbers only, with no prompts, file names or content, and stays in Claude Code's local plugin store on this machine. Hourly counts older than eight days and sessions older than 40 days are deleted.
- **What its hooks change:** nothing. Every event it hooks is passed on unchanged. It reads `agent.spawn` only for the new agent's id and model, and `tool.call` only for the activity shown in the tree. It never blocks a tool, rewrites a prompt or changes settings.
- **What it adds:** the `/canopy` command, which it answers itself. It adds no tools and no agents, and it handles no other command. `/canopy show` prints the band as text into your conversation, activity included, so it becomes part of the session like any other command output. Nothing else the plugin draws enters the conversation.

## Update or remove

From a shell (restart Claude Code after an update). Update the marketplace you installed from: `jonw09` for option 1, `claude-context-canopy` for option 2.

```
claude plugin marketplace update jonw09
claude plugin update context-canopy
claude plugin disable context-canopy
claude plugin uninstall context-canopy
```

## Licence

[MIT](LICENSE) © 2026 jonw09
