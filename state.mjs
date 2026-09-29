/**
 * Where the TUI keeps its state on this machine.
 *
 * Shared by `pending.mjs` (reads the TUI's own `model.json`) and `plan.mjs`
 * (owns the plugin's `go-quota.json`). Keeping the path rule in one place means
 * `XDG_STATE_HOME` is honoured everywhere or nowhere.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** `<XDG_STATE_HOME>/opencode`, which is `~/.local/state/opencode` by default. */
export function stateDirectory(env = process.env) {
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode");
}
