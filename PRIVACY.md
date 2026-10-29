# Privacy

Context Canopy is a Claude Code plugin that draws a band of usage figures above the prompt. This page sets out everything it reads, sends, keeps and changes.

## In short

- It makes **one kind of network request**, repeated while a session runs: it asks Anthropic what your account has spent this month, the same request Claude Code's own `/usage` makes. Nothing else leaves your machine.
- Claude Code signs that request with your login and sends it to Anthropic alone. **The plugin never sees your credentials.**
- It sends **nothing about your work**: no prompts, code, file names or conversation.
- It keeps only **numbers**, on this machine.
- `/canopy set spend off` stops the request.

## The one request it makes

| | |
| --- | --- |
| **What** | `GET https://api.anthropic.com/api/oauth/usage`, the request behind Claude Code's `/usage` and claude.ai's usage page |
| **Why** | To show what your account has spent this billing period and how much of your spend limit that is. Claude Code doesn't give plugins that figure any other way |
| **Your login** | The plugin asks Claude Code for a handle to the session's login and passes the handle to Claude Code's own request function. Claude Code adds the credential itself, only for Anthropic's own servers, and never shows it to the plugin |
| **What it sends** | The request alone, signed as above. Nothing about you or your work |
| **What comes back** | Your account's usage figures. The plugin keeps the amount spent, the limit, the percentage used, the currency and the reset date, in memory for the session only, and saves none of it |
| **When** | When a session starts, every five minutes, and after Claude replies (at most once a minute) |
| **Not made** | With an API key, through a Claude gateway or a cloud provider (Claude Code gives the plugin no login to use), or after `/canopy set spend off`. The request goes through Claude Code's own request function, so Claude Code decides whether it is allowed |

Anthropic handles that request as it handles Claude Code's own, under [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

## What it reads on your machine

Through Claude Code's plugin API, as the session runs:

- this session's model, token counts, cost and plan limit windows
- the list of running agents, with each agent's name, type, description, status, model and token counts
- the tool each agent calls, with that tool's main argument (a file path, a shell command, a search pattern or web search, the site of a web fetch, or an agent's task description), to show what each agent is doing
- the apps attached to the session, for `/canopy status`

The agents' activity is held in memory for the session only. It is drawn in the band and never saved or sent anywhere by the plugin.

## What it keeps

In Claude Code's local plugin store, on this machine only:

| What | Kept for |
| --- | --- |
| An hourly count of tokens per model family, for the `≈` model shares | 8 days |
| Each session's tokens per model family, keyed by when the session started, so a resumed session picks them up again (its cost comes back from Claude Code itself) | 40 days after it was last seen |
| Your `/canopy set` choices | Until you change them or run `/canopy reset` |

All of it is numbers: no prompts, file names, code or content.

## What it changes

Nothing. Every event it hooks is passed on unchanged. It reads `agent.spawn` only for the new agent's id and model, and `tool.call` only for the activity shown in the tree. It never blocks a tool, rewrites a prompt or changes a setting.

## What it adds

The `/canopy` command, which it answers itself. It adds no tools and no agents, handles no other command and calls no model. `/canopy show` prints the band as text into your conversation, activity included, so it becomes part of the session like any other command output. Nothing else the plugin draws enters the conversation.

## Turning things off

- `/canopy set spend off` stops the request to Anthropic and removes the spend row.
- `/canopy set plan off`, `session off` or `agents off` hide those parts of the band.
- Uninstalling the plugin stops all of it: `claude plugin uninstall context-canopy`.

## Questions

Open an issue at [github.com/jonw09/claude-context-canopy/issues](https://github.com/jonw09/claude-context-canopy/issues).
