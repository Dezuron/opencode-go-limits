// The debug log is the only window into TUI-side failures, so it gets tests too.
// Run: bun run test   (or: node --test test/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Cache-busting queries give each import a fresh evaluation of the env vars.
const moduleUrl = new URL("../debug.mjs", import.meta.url).href;

async function waitFor(check, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test("debug stays silent until GO_LIMITS_DEBUG=1", async () => {
  delete process.env.GO_LIMITS_DEBUG;
  const dir = await mkdtemp(join(tmpdir(), "go-limits-debug-off-"));
  process.env.GO_LIMITS_DEBUG_FILE = join(dir, "debug.log");

  const mod = await import(`${moduleUrl}?off`);
  assert.equal(mod.DEBUG_ENABLED, false);
  mod.debug("test", "must not be written");

  const written = await waitFor(async () => {
    try {
      await readFile(process.env.GO_LIMITS_DEBUG_FILE, "utf8");
      return true;
    } catch {
      return false;
    }
  }, 200);
  assert.equal(written, false);

  await rm(dir, { recursive: true, force: true });
});

test("debug appends a scoped line when enabled", async () => {
  process.env.GO_LIMITS_DEBUG = "1";
  const dir = await mkdtemp(join(tmpdir(), "go-limits-debug-on-"));
  const file = join(dir, "debug.log");
  process.env.GO_LIMITS_DEBUG_FILE = file;

  const mod = await import(`${moduleUrl}?on`);
  assert.equal(mod.DEBUG_ENABLED, true);
  mod.debug("tui", "hello from test");

  const written = await waitFor(async () => {
    try {
      return (await readFile(file, "utf8")).includes("[tui] hello from test");
    } catch {
      return false;
    }
  });
  assert.equal(written, true);

  delete process.env.GO_LIMITS_DEBUG;
  await rm(dir, { recursive: true, force: true });
});
