// Tests for the "model just picked in the picker" hint.
// Run: bun run test   (or: node --test test/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stateDirectory } from "../state.mjs";
import { modelStateFile, pendingHint, readPendingModel } from "../pending.mjs";

test("state file follows XDG_STATE_HOME and the default layout", () => {
  assert.equal(stateDirectory({ XDG_STATE_HOME: "D:/state" }), join("D:/state", "opencode"));
  assert.ok(stateDirectory({}).endsWith(join(".local", "state", "opencode")));
  assert.ok(modelStateFile({ XDG_STATE_HOME: "D:/state" }).endsWith(join("state", "opencode", "model.json")));
});

test("reads the last picked model from the TUI state file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "go-limits-pending-"));
  const file = join(dir, "model.json");
  await writeFile(
    file,
    JSON.stringify({
      recent: [
        { providerID: "opencode-go", modelID: "glm-5.3" },
        { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" },
      ],
      favorite: [],
      variant: {},
    }),
  );

  assert.deepEqual(await readPendingModel(file), { providerID: "opencode-go", id: "glm-5.3" });
  await rm(dir, { recursive: true, force: true });
});

test("missing, broken or unexpected files yield no hint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "go-limits-pending-"));
  assert.equal(await readPendingModel(join(dir, "absent.json")), undefined);

  const broken = join(dir, "broken.json");
  await writeFile(broken, "{ not json");
  assert.equal(await readPendingModel(broken), undefined);

  const empty = join(dir, "empty.json");
  await writeFile(empty, JSON.stringify({ recent: [] }));
  assert.equal(await readPendingModel(empty), undefined);

  const wrongShape = join(dir, "wrong.json");
  await writeFile(wrongShape, JSON.stringify({ recent: [{ providerID: 1, modelID: null }] }));
  assert.equal(await readPendingModel(wrongShape), undefined);

  await rm(dir, { recursive: true, force: true });
});

test("a UTF-8 BOM does not break the read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "go-limits-pending-"));
  const file = join(dir, "bom.json");
  await writeFile(file, `\uFEFF${JSON.stringify({ recent: [{ providerID: "opencode-go", modelID: "glm-5.3" }] })}`);
  assert.deepEqual(await readPendingModel(file), { providerID: "opencode-go", id: "glm-5.3" });
  await rm(dir, { recursive: true, force: true });
});

test("hint appears only for a different Go model", () => {
  const session = { providerID: "opencode-go", id: "deepseek-v4.1-flash" };

  assert.deepEqual(pendingHint(session, { providerID: "opencode-go", id: "glm-5.3" }), {
    providerID: "opencode-go",
    id: "glm-5.3",
  });
  assert.equal(pendingHint(session, session), undefined, "same model is not a hint");
  assert.equal(pendingHint(session, { providerID: "opencode", id: "big-pickle" }), undefined);
  assert.equal(pendingHint(session, undefined), undefined);
  assert.equal(pendingHint(undefined, { providerID: "opencode-go", id: "glm-5.3" }).id, "glm-5.3");
});
