# Changelog

## 0.1.0 (unreleased)

First version.

- Band above the prompt, always shown, with three sections: plan windows, session usage and the agent tree.
- Plan line: every rate-limit window the API reports (5h, 7d, gateway spend limit, and any new kind), with time to reset and an estimated split by model.
- Session line: tokens and cost, split by model.
- Agent tree: any depth, with model, context fill coloured against the auto-compact point, and what each agent is doing. Finished agents drop off.
- `/canopy` to collapse the band to one line and back.
- `/canopy show` to print the band as text where it can't be drawn (the mobile app on a cloud session), and `/canopy status` to check why it isn't showing.
- Nothing to configure on install. `/canopy set` changes the amber and red points, hides a section or turns off the model estimate, and `/canopy reset` puts the defaults back.
- The plan row is headed **Plan Limits**, or with the organisation's plan for organisation-managed installs, and says when no limits are reported.
