# Changelog

## [0.3.0](https://github.com/jonw09/claude-context-canopy/compare/v0.2.0...v0.3.0) (2026-10-23)


### Features

* read the month's spend from Anthropic and make every bar a health gauge ([#23](https://github.com/jonw09/claude-context-canopy/issues/23)) ([4063a50](https://github.com/jonw09/claude-context-canopy/commit/4063a50dcfbd473cb5774aeba48e48d402032b96))

## [0.2.0](https://github.com/jonw09/claude-context-canopy/compare/v0.1.5...v0.2.0) (2026-10-23)


### Features

* show Enterprise spend by the month, add per-agent token counts, and fit the band to its room ([#21](https://github.com/jonw09/claude-context-canopy/issues/21)) ([90581df](https://github.com/jonw09/claude-context-canopy/commit/90581df10affb76d5bf23f3838836347fe38a675))

## [0.1.5](https://github.com/jonw09/claude-context-canopy/compare/v0.1.4...v0.1.5) (2026-10-23)


### Documentation

* offer the plugin marketplace as the main install route ([#18](https://github.com/jonw09/claude-context-canopy/issues/18)) ([ee33d9a](https://github.com/jonw09/claude-context-canopy/commit/ee33d9ab9adb1bd59ac1cab4e90cffaf1d8bb52c))
* write the README for people using the plugins only ([#19](https://github.com/jonw09/claude-context-canopy/issues/19)) ([3ea23ff](https://github.com/jonw09/claude-context-canopy/commit/3ea23ffb7eb5b7e1a97e723ac05c3d46fcbe4d51))

## [0.1.4](https://github.com/jonw09/claude-context-canopy/compare/v0.1.3...v0.1.4) (2026-10-22)


### Documentation

* fix the README icon, which failed to load ([#16](https://github.com/jonw09/claude-context-canopy/issues/16)) ([2a557f5](https://github.com/jonw09/claude-context-canopy/commit/2a557f5151ce58e0c566d26c675b0421ab4908e9))

## [0.1.3](https://github.com/jonw09/claude-context-canopy/compare/v0.1.2...v0.1.3) (2026-10-22)


### Documentation

* use a sharp SVG icon at the top of the README ([#14](https://github.com/jonw09/claude-context-canopy/issues/14)) ([cbb1cd0](https://github.com/jonw09/claude-context-canopy/commit/cbb1cd0456f2398c23598741902e7ed86af700aa))

## [0.1.2](https://github.com/jonw09/claude-context-canopy/compare/v0.1.1...v0.1.2) (2026-10-22)


### Documentation

* bring the icon back to the top of the README ([#12](https://github.com/jonw09/claude-context-canopy/issues/12)) ([af68a31](https://github.com/jonw09/claude-context-canopy/commit/af68a31f35bc3d576cace2780ddc0d74b30a0af2))

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
