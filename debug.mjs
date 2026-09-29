/**
 * Opt-in diagnostic log for the Go limits plugin.
 *
 * Off by default. Set `GO_LIMITS_DEBUG=1` (and optionally
 * `GO_LIMITS_DEBUG_FILE=<path>`) to append one line per setup, refresh, RPC
 * call and rendered row.
 *
 * This exists because TUI plugin errors never reach the OpenCode server log —
 * without it, a broken widget is invisible.
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const DEBUG_ENABLED = process.env.GO_LIMITS_DEBUG === "1";
export const DEBUG_FILE =
  process.env.GO_LIMITS_DEBUG_FILE ?? join(tmpdir(), "go-limits-debug.log");

/** Appends `[scope] message` when debugging is enabled. Never throws. */
export function debug(scope, message) {
  if (!DEBUG_ENABLED) return;
  void appendFile(DEBUG_FILE, `${new Date().toISOString()} [${scope}] ${message}\n`).catch(
    () => {},
  );
}
