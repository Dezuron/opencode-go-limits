# Changelog

The version in `package.json` matches the tag (`vX.Y.Z`).

## v1.0.0 — 2026-09-29

First public release.

### Quota windows

- The 5-hour, weekly and monthly usage windows from the official endpoint
  (`GET https://opencode.ai/zen/go/v1/usage`) in the session sidebar, next to the
  MCP servers. The numbers are *used* percentages, so they match the [OpenCode
  console](https://console.opencode.ai). Each row shows the time left until the
  window resets; the bar turns yellow at 70% and red at 90% (or when the
  provider reports `rate-limited`).
- The block header shows when the plugin will refresh the metrics next, counting
  down every second.

### Tariff: Go or Go Plus

- `docs/go` publishes two tariffs and the per-model limits differ between them.
  The tariff is a stored choice, not a guess: nothing reachable with the Go API
  key exposes it — `zen/go/v1/usage` returns percentages only, and the console
  endpoint that does know sits behind session cookies.
- Click the block header to switch between `● Go quota` and `● Go Plus quota`.
  The choice lives in `~/.local/state/opencode/go-limits.json` and survives
  restarts; `GO_LIMITS_PLAN=go|plus` seeds it for headless setups.
- The two tables are told apart by the Starlight tab label, never by their order
  on the page — identical headers would otherwise serve Go Plus numbers to a Go
  subscriber.

### Session model

- The session model and its estimated requests per month for the selected
  tariff, red below `80 000`. Models the docs call `Unlimited` show `unlimited`
  and sort first.
- A collapsible list of the models that meet the threshold, so a too-limited
  model can be swapped right away.
- The model picked in `/models` shows immediately, marked `selected, applies on
  next request` — OpenCode sends the choice to the server only with the next
  prompt.
- Promo markup (`4x · Ends Sep 20`) is still parsed and highlighted; the current
  page carries none.

### Install

- Clone the repository and point `plugins` at the directory — see the README.
  `opencode plugin add` is not supported yet: a package under `node_modules`
  resolves `solid-js` to its SSR build, where `createEffect` never runs, so the
  widget would render once and freeze. OpenCode's Solid transform covers only
  files outside `node_modules`.

### Tooling

- `bun run test` (unit tests), `bun run check` (transpile check), `bun run smoke`
  (live health check; `-Standalone` uses a private server). Smoke also compares
  the installed `@opencode/plugin` version with the CLI and fails if a plugin
  half did not load while it ran.
- `GO_LIMITS_DEBUG=1` writes a debug log, because TUI-side failures never reach
  the OpenCode server log.
