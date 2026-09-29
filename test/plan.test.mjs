// Tests for the tariff choice: saved file > GO_LIMITS_PLAN > "go".
// Run: bun run test   (or: node --test test/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stateDirectory } from "../state.mjs";
import {
  DEFAULT_PLAN,
  normalizePlan,
  otherPlan,
  planStateFile,
  readPlan,
  writePlan,
} from "../plan.mjs";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "go-limits-plan-"));
}

test("the state file lives next to the TUI state, in the plugin's own file", () => {
  assert.equal(
    planStateFile({ XDG_STATE_HOME: "D:/state" }),
    join("D:/state", "opencode", "go-limits.json"),
  );
  assert.ok(planStateFile({}).endsWith(join(stateDirectory({}), "go-limits.json")));
});

test("plan values are normalized, unknown ones rejected", () => {
  assert.equal(normalizePlan("go"), "go");
  assert.equal(normalizePlan("Go"), "go");
  assert.equal(normalizePlan(" plus "), "plus");
  assert.equal(normalizePlan("go-plus"), "plus");
  assert.equal(normalizePlan("Go Plus"), "plus");
  assert.equal(normalizePlan("goplus"), "plus");
  assert.equal(normalizePlan("enterprise"), undefined);
  assert.equal(normalizePlan(""), undefined);
  assert.equal(normalizePlan(undefined), undefined);
  assert.equal(normalizePlan(42), undefined);
});

test("without a file or env the default is Go and the UI should offer the switch", async () => {
  const dir = await tempDir();
  assert.deepEqual(await readPlan(join(dir, "go-limits.json"), {}), {
    plan: DEFAULT_PLAN,
    source: "default",
  });
  assert.equal(DEFAULT_PLAN, "go");
  await rm(dir, { recursive: true, force: true });
});

test("GO_LIMITS_PLAN seeds the choice when nothing is saved", async () => {
  const dir = await tempDir();
  assert.deepEqual(await readPlan(join(dir, "go-limits.json"), { GO_LIMITS_PLAN: "plus" }), {
    plan: "plus",
    source: "env",
  });
  assert.deepEqual(await readPlan(join(dir, "go-limits.json"), { GO_LIMITS_PLAN: "nonsense" }), {
    plan: "go",
    source: "default",
  });
  await rm(dir, { recursive: true, force: true });
});

test("a saved choice outranks the env and survives a BOM", async () => {
  const dir = await tempDir();
  const file = join(dir, "go-limits.json");

  assert.equal(await writePlan("plus", file), true);
  assert.deepEqual(await readPlan(file, { GO_LIMITS_PLAN: "go" }), { plan: "plus", source: "file" });

  await writeFile(file, `\uFEFF${JSON.stringify({ plan: "go" })}`);
  assert.deepEqual(await readPlan(file, { GO_LIMITS_PLAN: "plus" }), { plan: "go", source: "file" });

  await rm(dir, { recursive: true, force: true });
});

test("a broken or unknown saved value falls back to env, then to the default", async () => {
  const dir = await tempDir();
  const file = join(dir, "go-limits.json");

  await writeFile(file, "{ not json");
  assert.deepEqual(await readPlan(file, { GO_LIMITS_PLAN: "plus" }), { plan: "plus", source: "env" });

  await writeFile(file, JSON.stringify({ plan: "enterprise" }));
  assert.deepEqual(await readPlan(file, {}), { plan: "go", source: "default" });

  await rm(dir, { recursive: true, force: true });
});

test("writePlan creates missing directories and refuses unknown values", async () => {
  const dir = await tempDir();
  const file = join(dir, "nested", "go-limits.json");

  assert.equal(await writePlan("plus", file), true);
  assert.deepEqual(await readPlan(file, {}), { plan: "plus", source: "file" });

  assert.equal(await writePlan("enterprise", file), false);
  assert.deepEqual(await readPlan(file, {}), { plan: "plus", source: "file" });

  await rm(dir, { recursive: true, force: true });
});

test("a click switches to the other tariff", () => {
  assert.equal(otherPlan("go"), "plus");
  assert.equal(otherPlan("plus"), "go");
});
