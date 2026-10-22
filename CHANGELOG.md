# Changelog

## [0.1.1](https://github.com/jonw09/claude-context-canopy/compare/v0.1.0...v0.1.1) (2026-10-22)


### Bug Fixes

* head the plan row Plan Limits for every account ([#5](https://github.com/jonw09/claude-context-canopy/issues/5)) ([9bac103](https://github.com/jonw09/claude-context-canopy/commit/9bac10374835a4eb4e2cf43c61c68834e89c7bb1))


### Documentation

* say how long usage counts are kept and what /canopy show shares ([#11](https://github.com/jonw09/claude-context-canopy/issues/11)) ([992ca5d](https://github.com/jonw09/claude-context-canopy/commit/992ca5d09154d6fb6705f55a89823e4700b724f9))


### Tests

* drop the web address from the tool description test ([#10](https://github.com/jonw09/claude-context-canopy/issues/10)) ([b0fc43e](https://github.com/jonw09/claude-context-canopy/commit/b0fc43e3f88463b996c4b31acaadaee3d813810d))


### Continuous Integration

* list every pull request type in the changelog ([#9](https://github.com/jonw09/claude-context-canopy/issues/9)) ([afd9e00](https://github.com/jonw09/claude-context-canopy/commit/afd9e0022e439f723e4b7039093e1b9361e17dfa))


### Miscellaneous Chores

* clear the plugin directory's warnings ([#7](https://github.com/jonw09/claude-context-canopy/issues/7)) ([3dce42a](https://github.com/jonw09/claude-context-canopy/commit/3dce42a87fc0813ee5c149a39cbca2d6955882f8))
* drop the screenshot script and add directory links ([#8](https://github.com/jonw09/claude-context-canopy/issues/8)) ([06f0663](https://github.com/jonw09/claude-context-canopy/commit/06f06631c7b63d01c018c4b5b9dc249753a2ddc9))

## 0.1.0 (2026-10-22)


### Features

* /canopy collapses the band to one line and back ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
* /canopy show prints the band as text where it can't be drawn, and /canopy status explains why it isn't showing ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
* agent tree at any depth, with each agent's model, context fill coloured against the auto-compact point, and current step; finished agents drop off ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
* band above the prompt, always shown, with plan windows, session usage and the agent tree ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
* nothing to configure on install; /canopy set changes the amber and red points, hides a section or turns off the model estimate, and /canopy reset restores the defaults ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
* plan line with every rate-limit window the API reports (5h, 7d, a gateway spend limit and any new kind), the time to reset, and an estimated split by model ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
* plan row headed Plan Limits, or with the organisation's plan for managed installs, and says when no limits are reported ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
* session line with tokens and cost, split by model ([6da095b](https://github.com/jonw09/claude-context-canopy/commit/6da095bf49edba320af377987eeb413f6beaf7a7))
