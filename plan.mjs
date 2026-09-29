/**
 * Which OpenCode Go tariff the sidebar shows: `go` or `plus`.
 *
 * Why this is a stored choice rather than a guess: the two tariffs are separate
 * tables on https://opencode.ai/docs/go, and nothing reachable with the Go API
 * key says which one was bought — the usage endpoint returns percentages only,
 * `/zen/go/v1/models` returns ids only, and the console endpoint that does know
 * (`/api/internal/orgs/:orgId/go/status`) is behind console session cookies.
 * So the user picks, the choice is remembered here, and the docs tabs do the rest.
 *
 * Precedence: saved file > `GO_LIMITS_PLAN` > `go`. The file wins because it is
 * the user's most recent explicit click; the env var is a seed for headless
 * setups, and `source` tells the TUI whether to hint that a click changes it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stateDirectory } from "./state.mjs";

export const PLANS = ["go", "plus"];
export const DEFAULT_PLAN = "go";

/** `~/.local/state/opencode/go-limits.json` — the plugin's own file. */
export function planStateFile(env = process.env) {
  return join(stateDirectory(env), "go-limits.json");
}

/** `"Go Plus"`, `"go-plus"`, `"plus"` → `"plus"`; anything else → `undefined`. */
export function normalizePlan(value) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (text === "go") return "go";
  if (text === "plus" || text === "goplus") return "plus";
  return undefined;
}

async function readSavedPlan(file) {
  try {
    const raw = await readFile(file, "utf8");
    // Windows editors and PowerShell happily add a BOM; JSON.parse chokes on it.
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    return normalizePlan(parsed?.plan);
  } catch {
    return undefined;
  }
}

/**
 * The tariff to show plus where it came from:
 * `{ plan: "go" | "plus", source: "file" | "env" | "default" }`.
 */
export async function readPlan(file = planStateFile(), env = process.env) {
  const saved = await readSavedPlan(file);
  if (saved) return { plan: saved, source: "file" };

  const fromEnv = normalizePlan(env.GO_LIMITS_PLAN);
  if (fromEnv) return { plan: fromEnv, source: "env" };

  return { plan: DEFAULT_PLAN, source: "default" };
}

/**
 * Persist the choice. Returns whether it was written — the UI keeps working
 * in memory when the state directory is not writable.
 */
export async function writePlan(plan, file = planStateFile()) {
  const value = normalizePlan(plan);
  if (!value) return false;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ plan: value }, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** The tariff a click switches to. */
export function otherPlan(plan) {
  return plan === "plus" ? "go" : "plus";
}
