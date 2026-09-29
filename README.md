# opencode-go-limits

An OpenCode TUI plugin that puts your **OpenCode Go / Go Plus** limits in the session sidebar — the same column that lists MCP servers. Everything in one place: the quota windows, the tariff they belong to, the session model with its monthly request allowance, and the models that offer more.

```
● Go quota · refresh in 42s
click to switch to Go Plus
5h   ▏░░░░░░░   1%  4h 43m
wk   █▊░░░░░░  22%  7h 44m
mo   █░░░░░░░  13%  19d 15h
GLM-5.3
≈1 080 req/mo
selected, applies on next request
▼ meet threshold ≥80 000 (7)
  LongCat 2.5 Preview…  unlimited
  Space Bunny Free      unlimited
  Muse Spark 1.3 Cont…  226 600
  Muse Spark 1.2 Cont…  226 600
  MiMo-V2.6-Flash       150 400
  MiMo-V2.5             150 400
  DeepSeek V4.1 Flash   130 000
```

## Install

Clone the repository somewhere stable and point OpenCode at the directory:

```sh
git clone https://github.com/Dezuron/opencode-go-limits ~/opencode-go-limits
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/home/me/opencode-go-limits"]
}
```

Forward slashes work on Windows too (`"C:/Users/me/opencode-go-limits"`). Any directory works — a clone is enough, there is no build step. Restart OpenCode afterwards and check `opencode plugin list`. To update, `git pull` in the checkout and restart.

### Why not `opencode plugin add`

Installed as a package (npm or Git) the widget paints once and then freezes. A package lives under `node_modules`, and there `solid-js` resolves to its **SSR build**, where `createEffect` never runs:

```sh
$ bun -e "console.log(import.meta.resolve('solid-js'))"   # inside an installed copy
…/node_modules/solid-js/dist/server.js                    # the build without reactivity
```

OpenCode's Solid transform covers only files *outside* `node_modules`, so a plugin directory gets the host's own Solid. For the same reason, do not add the package to `cli.json`: plugins configured in `opencode.json(c)` that expose a TUI component are loaded by the CLI automatically.

Requirements:

- OpenCode 2 (the plugin is built against the V2 plugin API)
- OpenCode Go or Go Plus connected: `/connect` → **OpenCode Go** → the key from your console
- A visible sidebar: `session.sidebar` = `auto` in `~/.config/opencode/cli.json`, and a terminal wide enough — OpenCode hides the sidebar in a narrow window, which is not the plugin's doing

## Quota windows

The numbers are **used percentages** from the official endpoint, so they match the [OpenCode console](https://console.opencode.ai): `5h`, `wk` and `mo`. On the right is the time until that window resets. The bar fills with usage: green below 70%, yellow at 70–89%, red from 90% or when the provider reports `rate-limited`. The windows are identical for both tariffs — the tariff only changes the model limits.

The header shows **when the plugin will refresh the metrics** (`refresh in 42s`), updated every second. It is not a window reset; resets are on the right of each row.

## Tariff: Go or Go Plus

`docs/go` describes two tariffs, and the model limits differ between them. The tariff cannot be detected automatically: `zen/go/v1/usage` returns percentages only, `/zen/go/v1/models` returns ids only, and the console endpoint that does know sits behind session cookies. So the plugin **asks once instead of guessing**:

- Click the block header to switch between `● Go quota` and `● Go Plus quota`. Until you choose, a hint sits under the header: `click to switch to Go Plus`.
- The choice is stored in `~/.local/state/opencode/go-limits.json` (the plugin's own file; `XDG_STATE_HOME` is honoured) and survives restarts.
- `GO_LIMITS_PLAN=go|plus` seeds the initial value for headless setups (`go-plus` is accepted too). Precedence: file → variable → `go`.
- If the page has no table for the selected tariff, that tariff cannot be switched to — a foreign tariff is never shown silently.

## Session model, limit and promo

Under the windows: the session model and its **estimated requests per month** from <https://opencode.ai/docs/go> for the selected tariff (the same estimate as the comparison table on the site). Token prices are not shown — the plugin's job is watching limits.

- **The `80 000` requests/month threshold** (`LOW_MONTHLY_REQUESTS` in `tui.tsx`). Below it, the model name and its number turn red.
- **The list of models that meet the threshold** — always under the model, best first; the header collapses on click, like the MCP server list. Long names are trimmed.
- **`unlimited` models** (LongCat 2.5 Preview Free, Space Bunny Free) show the word and sort first.
- **Promo.** Supported, although the current page carries no promo markup. If a model gets a marker such as `4x · Ends Sep 20`, the plugin shows `promo ×4 until 20.09` and, on the last day, `⚠ promo ×4 ends in 14h`. At the end date the limit switches to the base value (`32 500` instead of `130 000`) without waiting for the page to refresh, so the model honestly turns red and leaves the list.

### The model right after picking in `/models`

Worth knowing about OpenCode itself: **the model picker does not switch the session immediately.** It records the choice client-side and sends it to the server only with your next prompt. Until then `session.model` — the only thing plugins can read — still points at the previous model. That is OpenCode behaviour, not the plugin's.

So the plugin also watches the TUI's own state file (`~/.local/state/opencode/model.json`): picking a model writes it to the front of `recent`. While that entry differs from the session model, the block shows the **picked** model with `selected, applies on next request`, and drops the marker once the session catches up. The file is read every 5 seconds, read-only; if it is missing or shaped differently, the hint is simply not shown and the session model stays the source of truth.

How the limit is computed (confirmed by OpenCode's own code): for Go, `quotaCost = cost * modelInfo.costMultiplier`, i.e. **the dollar limit of the window is divided by the request's token cost multiplied by the model multiplier**. The site's "estimated requests" is exactly that estimate.

The page is parsed in `pricing.mjs` and cached for 15 minutes. The two tariffs' tables are told apart by the Starlight **tab label, never by their order** — identical headers would otherwise give a Go subscriber Go Plus numbers. If the page is unreachable or the markup changed, the model block disappears while the quota windows keep working. `test/pricing.test.mjs` runs against a saved copy of the page (`test/fixtures/docs-go.html`) and fails first.

## Diagnostics

```powershell
bun run smoke                  # plugin registered + RPC + page parsing
bun run smoke -- -Standalone   # the same on a private server, leaving your session alone
```

`smoke` checks five things: (1) the plugin is registered, (2) the RPC returns real quota data, (3) `docs/go` parses into both tariffs, (4) the installed `@opencode/plugin` matches the OpenCode CLI version, (5) no plugin half failed to load while the checks ran. The last one matters because a TUI half with a missing peer (`@opentui/solid`, `solid-js`) fails silently — the OpenCode log is the only place that shows up. On a problem smoke prints the code and a hint; a version mismatch is a warning, not an error.

Separately:

```powershell
opencode plugin list                                                 # registration
opencode api post /api/rpc/go-limits/get --data '{\"input\":{}}'     # server + key + network
opencode api post /api/rpc/go-limits/catalog --data '{\"input\":{}}' # limits for both tariffs
node --test test/                                                    # unit tests
bun run check                                                        # syntax of .ts/.tsx
```

If the server half changed recently and the service still holds an old version in memory (`rpc.unavailable`, `failed to load plugin`), restart the background service:

```sh
opencode service restart
```

### Debug mode

TUI plugin errors never reach the OpenCode log, so the plugin keeps its own:

```powershell
$env:GO_LIMITS_DEBUG = "1"
# optional: $env:GO_LIMITS_DEBUG_FILE = "$env:TEMP\go-limits-debug.log"
opencode
```

It writes to `%TEMP%\go-limits-debug.log`:

```
[tui]    setup interval=60000ms catalog=900000ms
[tui]    plan go source=default
[server] catalog go=30 plus=30
[tui]    catalog ok go=30 plus=30
[server] usage ok 5h=4% weekly=5% monthly=46%
[tui]    refresh ok 5h=4% weekly=5% monthly=46%
[tui]    render visible=true usage=yes plan=go models=30 model=deepseek-v4.1-flash
[tui]    row |5h   ▏░░░░░░░   4%  4h 43m|
[tui]    model render DeepSeek V4.1 Flash limit=≈130 000 req/mo low=false pending=no
[tui]    model sync(poll) deepseek-v4.1-flash
[tui]    alternatives=7
[tui]    plan switch plus                       # header click
[tui]    model render DeepSeek V4.1 Flash limit=≈260 000 req/mo low=false pending=no
[tui]    model event glm-5.3                      # model change via API/agent
[tui]    model store glm-5.3                      # same choice came from the TUI store
[tui]    pending opencode-go/glm-5.3              # picked in the picker (not applied yet)
[tui]    model render GLM-5.3 limit=≈1 080 req/mo low=true pending=yes
```

The model arrives by four paths: the `session.model.selected` event (from its payload), reactive reads of the TUI store, the minute poll with `invalidate`, and — for a model picked but not applied yet — the TUI state file. If the block ever sticks again, the log shows which path went quiet.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No widget, `plugin list` empty | the plugin is not registered, or the loader broke after an OpenCode update | re-add it with `opencode plugin add github:Dezuron/opencode-go-limits`, then `opencode plugin list` |
| `rpc.unavailable` / `failed to load plugin` in the log | the service holds an old (or broken) plugin load in memory | `opencode service restart` |
| No widget, but `plugin list` sees it | the sidebar is hidden (narrow terminal, `session.sidebar: "hide"`), or the slot API changed | widen the window; with `GO_LIMITS_DEBUG=1` check whether `[tui] render` is called |
| No model block | the session is not on an `opencode-go` model | switch to a Go model |
| Numbers look like Go Plus while on Go | the wrong tariff is selected (or an old plugin that took the last table) | click the `● … quota` header, or set `GO_LIMITS_PLAN=go` and delete `~/.local/state/opencode/go-limits.json`; the log line `[tui] plan <tariff> source=…` says what is in effect |
| Header click does not switch | the page has no table for the other tariff (`plans.plus` is empty) | `bun run smoke` — step 3 prints `Go Plus: none`; wait for the page to have both tabs |
| The block shows a model marked `selected, applies on next request` | expected: OpenCode sends the choice to the server only with the next prompt | nothing to do; the marker disappears after the first request |
| The model block never changes after picking in `/models` | none of the four paths fired | with `GO_LIMITS_DEBUG=1` look for `model event` / `model store` / `model sync(poll)` / `pending` — whichever is silent is the broken one |
| Model name but no request count | the model was not found in the limits table | the debug log shows `[tui] model … limit=-`; check the spelling in the table |
| Empty model list | no model meets the threshold, or the catalogue did not parse | `bun run smoke`; the log has `[tui] alternatives=N` and `[tui] catalog …` |
| Promo shown although it ended | the page is stale | it switches by itself: `effectiveMonthly` takes the base value right after the end date; if not, `bun run smoke` |
| The model list does not collapse | the mouse/slot API changed | compare with the MCP sidebar implementation in the plugin docs |
| `(stale)` in the header | the last request failed, previous numbers are shown | `bun run smoke`; check network/VPN |
| `Go is not connected` | no `opencode-go` key | `/connect` → OpenCode Go |
| `Go API key was rejected` | the key was revoked | re-issue it in the console and connect again |
| `No active Go subscription` | the key is valid but there is no subscription | check the subscription in the console |
| `Unexpected usage response` | the endpoint changed shape | update `index.ts` (parsing) and `rpc.ts` (schema) |
| `pricing-parse` in smoke | `docs/go` markup changed | refresh the fixture `test/fixtures/docs-go.html`, adjust `pricing.mjs`, run `bun run test` |
| Window numbers differ from the console by one point | the endpoint rounds percentages down, the console shows tenths | expected, nothing to fix |
| Nothing works after an OpenCode update | the plugin API changed | see below |

## After upgrading OpenCode

1. `opencode plugin list` — does the plugin load at all?
2. `npm install --save-exact "@opencode/plugin@<new opencode version>"` when working from a checkout — otherwise the server half will not load.
3. `ctx.integration.connection.active("opencode-go")` — was the integration renamed? (`index.ts`)
4. Sidebar slot: `context.ui.slot({ append: "sidebar.content", … })`, collapsing via `onMouseDown` on a `<box>` (`tui.tsx`).
5. Theme tokens: `text.base`, `text.muted`, `text.feedback.{success,warning,error}.base`. If they are renamed, colours silently fall back to defaults; the layout does not break.
6. `Rpc.define` / `ctx.rpc.register` / `context.client.rpc` — the RPC contract.
7. The `session.model.selected` event (payload `{ sessionID, model, previous }`) — where the session model comes from.
8. `docs/go` markup — two `requests per 5 hour` tables (one per tariff) inside Starlight tabs: the tab label (`<a id="tab-N">Go Plus</a>`) and the panel (`<div id="tab-panel-N" aria-labelledby="tab-N">`) in `pricing.mjs` + the fixture.

Current docs: <https://opencode.ai/v2/docs/build/plugins> and <https://opencode.ai/v2/docs/build/plugins/cli>.

## Rollback

```sh
git tag                    # list versions
git checkout v1.0.0 -- .   # restore a working version
```

To drop the plugin entirely: remove the entry from `plugins` in `opencode.jsonc` and run `opencode service restart`.

## Layout

| File | Role |
|---|---|
| `index.ts` | Server half: resolves the `opencode-go` credential through the integration API, polls `https://opencode.ai/zen/go/v1/usage`, fetches and parses the limits page every 15 minutes, serves everything over RPC |
| `rpc.ts` | RPC contract: `get` (quota) and `catalog` (limits for both tariffs). Schemas are deliberately loose |
| `tui.tsx` | Widget: `sidebar.content` slot, quota windows, clickable tariff header, model block with the threshold, collapsible alternatives list |
| `format.mjs` | Pure layout helpers: bar, alignment, countdown, level, row assembly |
| `pricing.mjs` | Limits-page parser: both tariffs by tab label, monthly request limit, base value, promo, threshold filter |
| `plan.mjs` | The selected tariff: reading/writing `go-limits.json`, `GO_LIMITS_PLAN`, value normalisation |
| `state.mjs` | Shared state path (`XDG_STATE_HOME` → `~/.local/state/opencode`) for `plan.mjs` and `pending.mjs` |
| `pending.mjs` | Reads the TUI state file (`model.json`) — the model picked but not yet applied to the session |
| `debug.mjs` | Opt-in log (`GO_LIMITS_DEBUG=1`) |
| `test/` | Unit tests: layout, debug log, tariff choice, limits parser for both tariffs (against `test/fixtures/docs-go.html`) |
| `scripts/` | `smoke.ps1` (health) and `check.mjs` (transpilation) |

Data flow: TUI → RPC → server → `opencode.ai`. **The key never leaves the server process** — only percentages, reset times and the limits catalogue travel to the TUI.

Polling: quota on start and every 60 seconds (`REFRESH_INTERVAL_MS`), catalogue on start and every 15 minutes (`CATALOG_INTERVAL_MS`), plus a 15-minute server cache. Timers are per process, not per session. Both endpoints are read-only.

## Development

```powershell
bun run test     # unit tests (node --test)
bun run check    # transpilation of .ts/.tsx
bun run smoke    # live check through OpenCode
```

Live run of the widget: start `opencode` in a Windows Terminal at ≥120 columns with `GO_LIMITS_DEBUG=1` and watch the `[tui] row …`, `[tui] model …`, `[tui] plan …`, `[tui] alternatives=N` lines — they show exactly what the sidebar draws.

The version in `package.json` matches the tag (`vX.Y.Z`). See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © 2026 Dezuron.
