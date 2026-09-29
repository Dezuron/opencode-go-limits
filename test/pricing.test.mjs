// Parser tests against a saved copy of https://opencode.ai/docs/go.
// If OpenCode changes that page's markup, these fail first — that is the point.
// Run: bun run test   (or: node --test test/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  effectiveMonthly,
  findModel,
  formatCount,
  formatModelListRow,
  formatPromoEnd,
  parseCell,
  parseLimitsDoc,
  parsePromo,
  promoStatus,
  promoText,
  qualifyingModels,
  resolveEndsAt,
} from "../pricing.mjs";

const html = await readFile(new URL("./fixtures/docs-go.html", import.meta.url), "utf8");
const catalog = parseLimitsDoc(html);
const go = catalog.plans.go;
const plus = catalog.plans.plus;

const THRESHOLD = 80000;
// The promo on DeepSeek V4.1 Flash runs until the end of 2026-09-20 (UTC).
const DURING_PROMO = new Date("2026-09-20T12:00:00Z");
const AFTER_PROMO = new Date("2026-09-21T12:00:00Z");

const REQUEST_HEADERS = [
  "Model",
  "Requests per 5 hours",
  "Requests per week",
  "Requests per month",
];

/** A synthetic `docs/go` snippet: tab label + panel + requests table. */
function panel(index, label, rows) {
  const head = REQUEST_HEADERS.map((header) => `<th>${header}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("");
  const table = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  const anchor = label === null ? "" : `<li><a id="tab-${index}" href="#">${label}</a></li>`;
  return `${anchor}<div id="tab-panel-${index}" aria-labelledby="tab-${index}" role="tabpanel">${table}</div>`;
}

test("the docs page carries both tariffs", () => {
  assert.ok(go.length >= 20, `expected many Go models, got ${go.length}`);
  assert.ok(plus, "the Go Plus tab should parse too");
  assert.ok(plus.length >= 20, `expected many Go Plus models, got ${plus.length}`);
  for (const model of [...go, ...plus]) {
    assert.ok(model.key, "every model needs a key");
    assert.ok(model.name, "every model needs a name");
  }
});

test("Go and Go Plus numbers come from their own tables, not the last one", () => {
  const goFlash = findModel(go, "deepseek-v4.1-flash");
  const plusFlash = findModel(plus, "deepseek-v4.1-flash");
  assert.equal(goFlash.monthly, 130000);
  assert.equal(plusFlash.monthly, 260000);

  const goGlm = findModel(go, "glm-5.3-flash");
  const plusGlm = findModel(plus, "glm-5.3-flash");
  assert.equal(goGlm.monthly, 31580);
  assert.equal(plusGlm.monthly, 94740);
});

test("tariff is chosen by the tab label, not by the order of the tables", () => {
  // Deliberately the Go Plus table first: order alone would pick the wrong one.
  const reversed = panel(0, "Go Plus", [["Model X", "200", "500", "2,000"]]) +
    panel(1, "Go", [["Model X", "100", "250", "1,000"]]);
  const parsed = parseLimitsDoc(reversed);
  assert.equal(findModel(parsed.plans.go, "model-x").monthly, 1000);
  assert.equal(findModel(parsed.plans.plus, "model-x").monthly, 2000);
});

test("unlabelled tables fall back to document order, a lone table yields no Plus", () => {
  const unlabelled = panel(0, null, [["Model X", "100", "250", "1,000"]]) +
    panel(1, null, [["Model X", "200", "500", "2,000"]]);
  const parsed = parseLimitsDoc(unlabelled);
  assert.equal(findModel(parsed.plans.go, "model-x").monthly, 1000);
  assert.equal(findModel(parsed.plans.plus, "model-x").monthly, 2000);

  // The pre-tariff page: one table means there is no Plus to switch to.
  const single = parseLimitsDoc(panel(0, "Go", [["Model X", "100", "250", "1,000"]]));
  assert.equal(single.plans.go.length, 1);
  assert.equal(single.plans.plus, null);

  const empty = parseLimitsDoc("<html><body>no tables</body></html>");
  assert.equal(empty.plans.go.length, 0);
  assert.equal(empty.plans.plus, null);
});

test("models the docs call Unlimited are marked, not silently dropped", () => {
  const free = findModel(go, "longcat-2.5-preview-free");
  assert.ok(free, "the free model should be in the Go catalog");
  assert.equal(free.unlimited, true);
  assert.equal(free.monthly, null);
  assert.equal(effectiveMonthly(free), Infinity);

  const rows = qualifyingModels(go, THRESHOLD, new Date());
  assert.equal(rows[0].unlimited, true, "unlimited models sort first");
  assert.equal(rows[0].monthly, Infinity);
  assert.ok(rows.every((row) => row.monthly >= THRESHOLD));
});

test("cell parser separates current value, struck-through original and note", () => {
  const cell = parseCell('<td><del>32,500</del><br><strong>130,000</strong><small>4x · Ends Sep 20</small></td>');
  assert.equal(cell.text, "130,000");
  assert.equal(cell.original, "32,500");
  assert.equal(cell.note, "4x · Ends Sep 20");
});

test("promo label yields multiplier and end date", () => {
  assert.deepEqual(parsePromo("4x · Ends Sep 20"), {
    label: "4x · Ends Sep 20",
    multiplier: 4,
    endsAt: "09-20",
  });
  assert.equal(parsePromo(null), null);
  assert.equal(parsePromo("limited time").endsAt, null);
});

test("a promo cell still parses into monthly, base value and promo", () => {
  // The current page has no promo markup; the parser keeps supporting it.
  const promoPage = parseLimitsDoc(
    panel(0, "Go", [
      [
        "DeepSeek V4.1 Flash<small>4x · Ends Sep 20</small>",
        "<del>6,500</del><br><strong>26,000</strong>",
        "65,000",
        "<del>32,500</del><br><strong>130,000</strong>",
      ],
    ]),
  );
  const model = findModel(promoPage.plans.go, "deepseek-v4.1-flash");
  assert.equal(model.monthly, 130000);
  assert.equal(model.baseMonthly, 32500);
  assert.equal(model.promo.multiplier, 4);
  assert.equal(model.promo.endsAt, "09-20");

  assert.equal(effectiveMonthly(model, DURING_PROMO), 130000);
  assert.equal(effectiveMonthly(model, AFTER_PROMO), 32500);
});

test("promo status reports the last day and expiry", () => {
  const promo = parsePromo("4x · Ends Sep 20");

  const lastDay = promoStatus(promo, DURING_PROMO);
  assert.equal(lastDay.active, true);
  assert.equal(lastDay.endsSoon, true);
  assert.equal(lastDay.hoursLeft, 12);
  assert.equal(formatPromoEnd(lastDay.endsAt), "20.09");

  const after = promoStatus(promo, AFTER_PROMO);
  assert.equal(after.active, false);
  assert.equal(after.endsSoon, false);
});

test("a promo date far in the past rolls into the next year", () => {
  const fromJanuary = resolveEndsAt("09-20", new Date("2027-01-05T00:00:00Z"));
  assert.equal(fromJanuary.slice(0, 10), "2027-09-20");
});

test("qualifying models keep only the threshold and are sorted best first", () => {
  const rows = qualifyingModels(go, THRESHOLD, new Date());
  assert.ok(rows.length >= 2, `expected alternatives, got ${rows.length}`);
  assert.ok(rows.every((row) => row.monthly >= THRESHOLD));
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(rows[index - 1].monthly >= rows[index].monthly, "sorted descending");
  }
  assert.ok(rows.some((row) => row.key === "deepseekv41flash"), "the session model counts");
  assert.ok(!rows.some((row) => row.key === "glm53flash"), "a small Go limit does not qualify");
});

test("unknown model ids resolve to nothing instead of a wrong model", () => {
  assert.equal(findModel(go, "totally-unknown-model"), null);
  assert.equal(findModel(go, undefined), null);
  assert.equal(findModel(undefined, "glm-5.3"), null);
});

test("counts and list rows format for the sidebar", () => {
  assert.equal(formatCount(226600), "226 600");
  assert.equal(formatCount(880), "880");
  assert.equal(formatCount(null), "—");

  assert.equal(
    formatModelListRow("Muse Spark 1.3 Contributor", 226600),
    "Muse Spark 1.3 Cont…  226 600",
  );
  assert.equal(formatModelListRow("MiMo-V2.5", 150400), "MiMo-V2.5             150 400");
  assert.equal(
    formatModelListRow("LongCat 2.5 Preview Free", Infinity, { unlimited: true }),
    "LongCat 2.5 Preview…  unlimited",
  );
});

test("promo labels format for the sidebar", () => {
  const promo = parsePromo("4x · Ends Sep 20");
  assert.equal(
    promoText(promo, promoStatus(promo, new Date("2026-09-19T12:00:00Z"))),
    "promo ×4 until 20.09",
  );
  assert.equal(
    promoText(promo, promoStatus(promo, new Date("2026-09-20T10:00:00Z"))),
    "⚠ promo ×4 ends in 14h",
  );
  assert.equal(
    promoText(promo, promoStatus(promo, new Date("2026-09-20T23:30:00Z"))),
    "⚠ promo ×4 ends under an hour",
  );
  assert.equal(promoText(null, { endsSoon: false, endsAt: "2026-09-20T23:59:59.999Z" }), "promo until 20.09");
});
