# AGENTS.md

Instructions for coding agents working in Bishun.

## Working rules

- Inspect current source before editing. Prefer the smallest correct change and existing conventions.
- Preserve user changes; avoid unrelated refactoring and unnecessary dependencies.
- Commit each completed, verified change promptly. Stage only files or hunks belonging to that change; leave unrelated user changes untouched. Report the commit and any blocked verification.
- Publish deployments only when requested or otherwise authorized in the session.
- Never read credential/secret files (`.env`, `credentials.env`, `*.pem`, `*.key`, SSH private keys, or cloud credentials). Verify credential state only through a project health/doctor command if one exists.
- Planning does not authorize implementation. Distinguish planned features from shipped behavior and verified results.

## Project references

- Read [README.md](README.md) for setup, commands, repository structure, current behavior, and test limitations. Verify against source when relevant to the task.
- Use the [Web refactoring plan](docs/Web重构计划.md) for current Web scope and acceptance criteria. The [K12 exploration](docs/K12产品设计与Web重构规划.md) is a long-term option pool, not an implementation backlog.
- Keep project facts and usage documentation in README; keep these instructions focused on agent behavior. Update the owning plan when an authorized scope change affects it.

## Implementation conventions

- Use ES modules, camelCase methods/variables, PascalCase classes, and async/await with explicit cleanup.
- Reuse existing engines and data before adding replacements. Verify HanziWriter options against the resolved dependency version.
- Keep input, character data, playback state, and view updates separate. All playback entries must share cancellation rules; stale callbacks must not mutate a superseded session.
- Cancel animation, audio, timers, and pending work before clearing instance references.
- Validate animation paths, stroke counts, order, and names before claiming teaching accuracy; do not treat ambiguous or default names as verified content.
- Keep Chinese UI text and `lang="zh-CN"`; provide labels, keyboard actions, visible focus, and accessible status messages.
- Use kebab-case CSS classes, mobile-first layout, Grid/Flexbox, and scoped rules. Avoid additional `!important` overrides. Existing colors, bounce effects, and auto-scroll are not redesign requirements.
- Keep useful diagnostics without exposing user content or secrets.

## Verification

- Inspect the diff and run relevant checks using README's commands; account for the documented test-runner limitations. Do not claim success from an unreliable exit code or missing fixtures.
- For implementation changes, run relevant regressions, syntax checks, and build as appropriate. Verify affected desktop/mobile UI; playback changes also need interruption, rapid input, media/resource failure, and background/resume coverage.
- Do not silently download fixtures to hide missing data. Report blocked checks and distinguish automated results from browser/device observations.
- For documentation-only changes, verify source-backed claims, links, consistency, and whitespace. Avoid dependency installation or unrelated runtime checks.
