// Unit tests for the pure helpers.
// Run: bun run test   (or: node --test test/)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WINDOWS,
  alignRight,
  bar,
  countdown,
  layoutRow,
  level,
  refreshInText,
  usedPercent,
} from "../format.mjs";

// Real response captured from GET https://opencode.ai/zen/go/v1/usage
const SAMPLE = {
  rolling: { status: "ok", percent: 2, resetsAt: "2026-09-20T15:36:55.539Z" },
  weekly: { status: "ok", percent: 19, resetsAt: "2026-09-21T00:00:00.000Z" },
  monthly: { status: "ok", percent: 12, resetsAt: "2026-10-10T08:04:22.000Z" },
};
const NOW = Date.parse("2026-09-20T13:00:00Z");

test("windows match the three quota windows shown in the console", () => {
  assert.deepEqual(
    WINDOWS.map((w) => [w.key, w.label]),
    [
      ["rolling", "5h"],
      ["weekly", "wk"],
      ["monthly", "mo"],
    ],
  );
});

test("percent is treated as *used*, like the console", () => {
  assert.equal(usedPercent(SAMPLE.rolling), 2);
  assert.equal(usedPercent({ percent: 140 }), 100);
  assert.equal(usedPercent(undefined), undefined);
  assert.equal(usedPercent({}), undefined);
});

test("bar splits fill (usage) from track and fills smoothly", () => {
  assert.deepEqual(bar(0, 8), { fill: "", track: "░░░░░░░░" });
  assert.deepEqual(bar(100, 8), { fill: "████████", track: "" });
  assert.deepEqual(bar(50, 8), { fill: "████", track: "░░░░" });
  assert.deepEqual(bar(4, 8), { fill: "▍", track: "░░░░░░░" });
  assert.deepEqual(bar(undefined, 8), { fill: "", track: "░░░░░░░░" });
});

test("bar always spans exactly the requested width", () => {
  for (const percent of [0, 1, 4, 12.5, 33, 49.9, 50, 51, 66, 87, 99, 100, 101, -5]) {
    const { fill, track } = bar(percent, 8);
    assert.equal([...fill].length + [...track].length, 8, `percent=${percent}`);
  }
});

test("level escalates with usage and honours provider status", () => {
  assert.equal(level({ status: "ok", percent: 0 }), "ok");
  assert.equal(level({ status: "ok", percent: 69 }), "ok");
  assert.equal(level({ status: "ok", percent: 70 }), "warn");
  assert.equal(level({ status: "ok", percent: 89 }), "warn");
  assert.equal(level({ status: "ok", percent: 90 }), "error");
  assert.equal(level({ status: "rate-limited", percent: 5 }), "error");
  assert.equal(level(undefined), "none");
});

test("percentages align into a stable column", () => {
  assert.equal(alignRight("4%", 4), "  4%");
  assert.equal(alignRight("20%", 4), " 20%");
  assert.equal(alignRight("100%", 4), "100%");
});

test("countdown formats days, hours and minutes", () => {
  assert.equal(countdown(SAMPLE.rolling.resetsAt, NOW), "2h 37m");
  assert.equal(countdown(SAMPLE.weekly.resetsAt, NOW), "11h 0m");
  assert.equal(countdown("2026-10-10T08:04:22.000Z", NOW), "19d 19h");
  assert.equal(countdown("2026-09-20T12:59:00.000Z", NOW), "now");
  assert.equal(countdown("not a date", NOW), undefined);
});

test("refreshInText shows when the plugin will refresh the metrics", () => {
  const now = Date.parse("2026-09-22T07:00:00Z");

  // last poll 40 seconds ago, interval 60 seconds
  assert.equal(refreshInText(now - 40_000, now, 60_000), "refresh in 20s");
  // polled just now — exactly a minute until the next one
  assert.equal(refreshInText(now, now, 60_000), "refresh in 1m 00s");
  // the poll ran past the interval — never goes negative
  assert.equal(refreshInText(now - 90_000, now, 60_000), "refresh in 0s");
  // interval longer than a minute
  assert.equal(refreshInText(now - 30_000, now, 120_000), "refresh in 1m 30s");
  // nothing polled yet
  assert.equal(refreshInText(0, now, 60_000), undefined);
  assert.equal(refreshInText(undefined, now, 60_000), undefined);
});

test("layoutRow renders the exact sidebar line", () => {
  const line = (label, win) => {
    const row = layoutRow({ label, win, width: 8, labelWidth: 4, percentWidth: 4, now: NOW });
    return `${row.label}${row.fill}${row.track} ${row.percent}${row.reset}`;
  };

  assert.equal(
    line("5h", { status: "ok", percent: 4, resetsAt: SAMPLE.rolling.resetsAt }),
    "5h   ▍░░░░░░░   4%  2h 37m",
  );
  assert.equal(
    line("wk", { status: "ok", percent: 20, resetsAt: SAMPLE.weekly.resetsAt }),
    "wk   █▋░░░░░░  20%  11h 0m",
  );
  assert.equal(
    line("mo", { status: "ok", percent: 12, resetsAt: SAMPLE.monthly.resetsAt }),
    "mo   █░░░░░░░  12%  19d 19h",
  );
});

test("layoutRow survives missing provider fields", () => {
  const row = layoutRow({ label: "5h", win: {}, now: NOW });
  assert.equal(row.percent, "   —  ");
  assert.equal(row.reset, "");
  assert.equal([...row.track].length, 8);
});

test("layoutRow keeps the column width stable as numbers grow", () => {
  const width = (percent) => {
    const row = layoutRow({
      label: "5h",
      win: { status: "ok", percent, resetsAt: SAMPLE.rolling.resetsAt },
      now: NOW,
    });
    return [...`${row.label}${row.fill}${row.track} ${row.percent}`].length;
  };
  assert.equal(width(4), width(20));
  assert.equal(width(20), width(100));
});
