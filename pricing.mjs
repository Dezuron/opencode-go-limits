/**
 * Parser for the public limits tables (https://opencode.ai/docs/go).
 *
 * The page describes two tariffs — **Go** and **Go Plus** — as Starlight tabs,
 * and each section carries one table per tariff. The "Estimated requests"
 * tables have identical headers, so they are told apart by the tab label
 * (`<a id="tab-N">Go Plus</a>` + `<div id="tab-panel-N" aria-labelledby="tab-N">`),
 * never by the order they appear in. Picking the last one would silently serve
 * Go Plus numbers to a Go subscriber.
 *
 *   <tr><td>DeepSeek V4.1 Flash<br><small>4x · Ends Sep 20</small></td>
 *       <td><del>6,500</del><br><strong>26,000</strong></td> ... </tr>
 *
 * Only the monthly column is kept: it is the number the widget shows and the
 * one the threshold compares against. `Unlimited` entries (free, limited-time
 * models) keep `monthly: null` plus an explicit `unlimited: true`, because
 * `Infinity` would not survive the RPC's JSON. Everything here is pure, so the
 * whole module is testable against `test/fixtures/docs-go.html`. If OpenCode
 * changes the markup, the fixture test fails first and the widget stops showing
 * the model block until the parser is updated.
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&times;/g, "×");
}

/** Tag-free, whitespace-collapsed text. */
export function clean(text) {
  return decodeEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Split one table cell into the current text, the struck-through original value
 * (`<del>`) and the small note (`<small>`, e.g. the promo label).
 */
export function parseCell(raw) {
  const original = /<(?:del|s|strike)[^>]*>([\s\S]*?)<\/(?:del|s|strike)>/i.exec(raw);
  const note = /<small[^>]*>([\s\S]*?)<\/small>/i.exec(raw);
  const text = clean(
    raw
      .replace(/<(?:del|s|strike)[^>]*>[\s\S]*?<\/(?:del|s|strike)>/gi, "")
      .replace(/<small[^>]*>[\s\S]*?<\/small>/gi, ""),
  );
  return { text, original: original ? clean(original[1]) : null, note: note ? clean(note[1]) : null };
}

function cellsOf(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => parseCell(m[1]));
}

/** Tab labels keyed by the id their panels point at: `tab-3` → `Go Plus`. */
function tabLabels(html) {
  const labels = new Map();
  for (const match of html.matchAll(/<a[^>]*\bid="(tab-\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    labels.set(match[1], clean(match[2]));
  }
  return labels;
}

/** Every `<table>` with the label of the tab panel it sits in (`null` outside tabs). */
function readTables(html) {
  const labels = tabLabels(html);
  const panels = [...html.matchAll(/<div[^>]*\bid="(tab-panel-\d+)"[^>]*>/gi)].map((match) => ({
    at: match.index,
    label:
      labels.get(/aria-labelledby="([^"]+)"/.exec(match[0])?.[1]) ??
      labels.get(match[1].replace("tab-panel", "tab")) ??
      null,
  }));

  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => {
    const table = match[1];
    const head = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(table)?.[1] ?? "";
    const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1] ?? "";
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => cellsOf(row[1]));
    // The nearest panel that opened before the table owns it.
    const panel = panels.filter((candidate) => candidate.at < match.index).at(-1);
    return { headers: cellsOf(head).map((cell) => cell.text), rows, plan: panel?.label ?? null };
  });
}

/** `26,000` -> `26000`. */
export function parseCount(text) {
  const match = /([\d,]+)/.exec(text ?? "");
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

/** `DeepSeek V4.1 Flash` -> `deepseekv41flash`, so ids and names can be matched. */
export function modelKey(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** `4x · Ends Sep 20` -> `{ multiplier: 4, endsAt: "09-20", label }`. */
export function parsePromo(note) {
  if (!note) return null;
  const multiplier = /^\s*(\d+(?:[.,]\d+)?)\s*[x×]/i.exec(note);
  const ends = /(?:Ends?|Until)\s+([A-Za-z]{3,9})\s+(\d{1,2})/i.exec(note);
  const month = ends ? MONTHS[ends[1].slice(0, 3).toLowerCase()] : undefined;
  return {
    label: note,
    multiplier: multiplier ? Number(multiplier[1].replace(",", ".")) : null,
    endsAt:
      month && ends
        ? `${String(month).padStart(2, "0")}-${String(Number(ends[2])).padStart(2, "0")}`
        : null,
  };
}

/** Does a tab label describe `plan`? `plus` needs the word; `go` is anything else labelled. */
function matchesPlan(label, plan) {
  if (!label) return false;
  const isPlus = /\bplus\b/i.test(label);
  return plan === "plus" ? isPlus : !isPlus;
}

/** Rows of one requests table as `{ key, name, monthly, baseMonthly, unlimited, promo }`. */
function modelsOf(table) {
  const models = new Map();
  if (!table) return [];

  for (const cells of table.rows) {
    if (cells.length < 4) continue;
    const nameCell = cells[0];
    if (!nameCell.text) continue;

    const key = modelKey(nameCell.text);
    if (!key) continue;

    const unlimited = /unlimited/i.test(cells[3].text ?? "");
    models.set(key, {
      key,
      name: nameCell.text,
      monthly: unlimited ? null : parseCount(cells[3].text),
      baseMonthly: cells[3].original === null ? null : parseCount(cells[3].original),
      unlimited,
      promo: parsePromo(nameCell.note),
    });
  }

  return [...models.values()];
}

/**
 * Catalog: `{ plans: { go, plus } }`, where each plan is a list of models.
 * `plus` is `null` when the page only offers one table — then there is no
 * second tariff to switch to.
 */
export function parseLimitsDoc(html) {
  const tables = readTables(html).filter((table) =>
    table.headers.some((header) => /requests per 5 hour/i.test(header)),
  );

  // Prefer the labelled tab; fall back to document order (Go first), which is
  // also what the pre-tariff page looked like.
  const goTable = tables.find((table) => matchesPlan(table.plan, "go")) ?? tables[0] ?? null;
  const plusTable =
    tables.find((table) => matchesPlan(table.plan, "plus")) ??
    tables.find((table) => table !== goTable) ??
    null;

  return {
    plans: {
      go: modelsOf(goTable),
      plus: plusTable && plusTable !== goTable ? modelsOf(plusTable) : null,
    },
  };
}

/** Match a session model id (`deepseek-v4.1-flash`) against one plan's models. */
export function findModel(models, modelID) {
  const key = modelKey(modelID);
  if (!key || !models?.length) return null;
  return (
    models.find((model) => model.key === key) ??
    models.find((model) => model.key.startsWith(key) || key.startsWith(model.key)) ??
    null
  );
}

/** `"09-20"` -> end of that day in UTC, using the closest sensible year. */
export function resolveEndsAt(endsAt, now) {
  const match = /^(\d{2})-(\d{2})$/.exec(endsAt ?? "");
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = now.getUTCFullYear();
  let candidate = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  if (candidate < now.getTime() - 180 * 24 * 3600 * 1000) {
    year += 1;
    candidate = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  }
  return new Date(candidate).toISOString();
}

/** `{ active, endsSoon, endsAt, hoursLeft }` for the promo block. */
export function promoStatus(promo, now = new Date()) {
  if (!promo) return { active: false, endsSoon: false, endsAt: null, hoursLeft: null };
  const endsAt = resolveEndsAt(promo.endsAt, now);
  if (!endsAt) return { active: true, endsSoon: false, endsAt: null, hoursLeft: null };

  const remainingMs = Date.parse(endsAt) - now.getTime();
  return {
    active: remainingMs > 0,
    endsSoon: remainingMs > 0 && remainingMs <= 24 * 3600 * 1000,
    endsAt,
    hoursLeft: Math.max(0, Math.round(remainingMs / 3_600_000)),
  };
}

/**
 * Requests per month the model offers *right now*: the promo value while the
 * promo lasts, otherwise the base value. This is what keeps the widget honest
 * when the cached page still carries the promo but the promo has expired.
 * `Infinity` marks a model the docs call Unlimited.
 */
export function effectiveMonthly(model, now = new Date()) {
  if (!model) return null;
  if (model.unlimited) return Infinity;
  if (promoStatus(model.promo, now).active) return model.monthly ?? null;
  return model.baseMonthly ?? model.monthly ?? null;
}

/** Models offering at least `threshold` requests per month, best first. */
export function qualifyingModels(models, threshold, now = new Date()) {
  return (models ?? [])
    .map((model) => ({
      key: model.key,
      name: model.name,
      monthly: effectiveMonthly(model, now),
      unlimited: Boolean(model.unlimited),
    }))
    .filter((row) => row.monthly !== null && row.monthly >= threshold)
    .sort((left, right) => right.monthly - left.monthly);
}

/** `2026-09-20T23:59:59.999Z` -> `20.09`. */
export function formatPromoEnd(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return match ? `${match[3]}.${match[2]}` : null;
}

/** `26000` -> `26 000`. */
export function formatCount(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Human label for the promo block: `promo ×4 until 20.09` or `⚠ … ends in 12h`. */
export function promoText(promo, status) {
  const times = promo?.multiplier ? `×${promo.multiplier}` : "";
  if (status?.endsSoon) {
    const hours = status.hoursLeft;
    const when = hours === null ? "soon" : hours <= 1 ? "under an hour" : `in ${hours}h`;
    return `⚠ promo ${times} ends ${when}`.replace("  ", " ");
  }
  const end = formatPromoEnd(status?.endsAt);
  return `promo ${times} until ${end ?? "?"}`.replace("  ", " ");
}

/** `Muse Spark 1.3 Contributor`, `226600` -> `Muse Spark 1.3 Contr…  226 600`. */
export function formatModelListRow(name, count, options = {}) {
  const width = options.nameWidth ?? 20;
  const text = String(name ?? "");
  const trimmed = text.length > width ? `${text.slice(0, width - 1)}…` : text;
  const value = options.unlimited ? "unlimited" : formatCount(count);
  return `${trimmed.padEnd(width)}  ${value}`;
}
