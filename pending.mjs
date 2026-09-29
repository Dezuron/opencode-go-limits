/**
 * Hint about the model the user just picked in the TUI model picker.
 *
 * Why this exists: picking a model does not switch the session immediately.
 * The picker records the choice client-side (`selectionBySessionAgent`) and the
 * TUI only calls `POST /api/session/{id}/model` when the next prompt is
 * submitted — so `session.model` (the only thing plugins can read) still shows
 * the previous model until then. That local map is not exposed to plugins.
 *
 * What is observable: every pick calls `addRecent`, which rewrites the TUI's
 * own state file `~/.local/state/opencode/model.json`. Its first `recent` entry
 * is therefore the model the user selected a moment ago. We use it only as a
 * hint — the session model stays the source of truth.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDirectory } from "./state.mjs";

export function modelStateFile(env = process.env) {
  return join(stateDirectory(env), "model.json");
}

/**
 * Last model added to the TUI's recent list, or `undefined` when the file is
 * missing, unreadable or shaped differently than expected.
 */
export async function readPendingModel(file = modelStateFile()) {
  try {
    const raw = await readFile(file, "utf8");
    // Windows editors and PowerShell happily add a BOM; JSON.parse chokes on it.
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const first = Array.isArray(parsed?.recent) ? parsed.recent[0] : undefined;
    const providerID = first?.providerID;
    const id = first?.modelID;
    if (typeof providerID !== "string" || typeof id !== "string") return undefined;
    return { providerID, id };
  } catch {
    return undefined;
  }
}

/**
 * The pending model, but only when it actually differs from the session's own
 * model — otherwise the hint would just repeat what is already shown.
 */
export function pendingHint(sessionModel, pending) {
  if (!pending?.id || !pending?.providerID) return undefined;
  if (pending.providerID !== "opencode-go") return undefined;
  if (sessionModel?.id === pending.id && sessionModel?.providerID === pending.providerID) {
    return undefined;
  }
  return pending;
}
