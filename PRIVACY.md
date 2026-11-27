# Privacy

Context Canopy is a Claude Code plugin that draws a band of usage figures above the prompt. This page sets out everything it reads, sends, keeps and changes.

## In short

- It makes **no network requests**. Nothing leaves your machine.
- It reads **no credentials**: no login, key, token or secret.
- It runs **no commands, tools or models**.
- It keeps only **numbers**, on this machine.

## What it reads on your machine

Through Claude Code's plugin API, as the session runs:

- this session's model, token counts, cost and plan limit windows
- the list of running agents, with each agent's name, type, description and status
- from each of Claude's replies, its model, token counts, and the name and main argument of the last tool call it asks for (a file path, a shell command, a search pattern or web search, the site of a web fetch, or an agent's task description), to show what each agent is doing
- an agent's newest conversation rows, only after it asks for a shell command or while it has one running in the background, to find a background shell's start and the notice that it has finished. Of those rows it keeps only each shell's ids, its description and its command
- at the start of each turn, its text, only to look for a notice that a background shell has finished
- the plan line of Claude Code's welcome logo in the terminal (such as `Claude Enterprise` or `API Usage Billing`), to name your plan when Claude Code reports no limit
- the apps attached to the session, for `/canopy status`
- Claude Code's version number, so the band is drawn in a way that version accepts

The agents' activity, their background shells and the plan's name are held in memory for the session only. They are drawn in the band and never saved or sent anywhere.

## What it keeps

In Claude Code's local plugin store, on this machine only:

| What | Kept for |
| --- | --- |
| An hourly count of tokens per model family, for the `≈` model shares | 8 days |
| Each session's tokens per model family, keyed by when the session started, so a resumed session picks them up again (its cost comes back from Claude Code itself) | 40 days after it was last seen |
| Your `/canopy set` choices | Until you change them or run `/canopy reset` |

All of it is numbers: no prompts, file names, code or content.

## What it changes

Nothing. Every event it hooks is passed on unchanged, except that it answers its own `/canopy` command and draws its band above the prompt. It doesn't hook tool calls or agent spawns, and never blocks a tool, rewrites a prompt or a reply, or changes a setting, instruction or tool description.

## What it adds

The `/canopy` command, which it answers itself. It adds no tools and no agents, handles no other command and calls no model. `/canopy show` prints the band as text into your conversation, activity included, so it becomes part of the session like any other command output. Nothing else the plugin draws enters the conversation.

## Turning things off

- `/canopy set plan off`, `session off` or `agents off` hide those parts of the band.
- `/canopy set shells off` hides background shells and stops the plugin reading agents' conversations for them.
- Uninstalling the plugin stops all of it: `claude plugin uninstall context-canopy`.

## Questions

Open an issue at [github.com/jonw09/claude-context-canopy/issues](https://github.com/jonw09/claude-context-canopy/issues).
