/**
 * Pure formatting helpers for the OpenCode Go limits widget.
 *
 * Deliberately plain ESM (`.mjs`) so the same functions can be exercised by
 * `node --test` outside the TUI runtime. The Go usage endpoint reports *used*
 * percentages, the same number the console shows — everything here works on
 * that input.
 */

/** Subscription windows, labelled as compactly as the sidebar allows. */
export const WINDOWS = [
  { key: "rolling", label: "5h" },
  { key: "weekly", label: "wk" },
  { key: "monthly", label: "mo" },
];

/** Eighth-width blocks, so a bar grows smoothly instead of jumping a cell. */
const BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const TRACK = "░";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Used percentage reported by the provider, clamped to 0..100. */
export function usedPercent(win) {
  const value = Number(win?.percent);
  return Number.isFinite(value) ? clamp(value, 0, 100) : undefined;
}

/**
 * Split a bar into the part that is filled (usage) and the remaining track.
 * Returned separately so the widget can colour them with different tokens.
 */
export function bar(percent, width = 8) {
  if (percent === undefined) return { fill: "", track: TRACK.repeat(width) };

  const cells = (clamp(percent, 0, 100) / 100) * width;
  let full = Math.floor(cells);
  let eighths = Math.round((cells - full) * 8);
  if (eighths === 8) {
    full += 1;
    eighths = 0;
  }
  full = Math.min(full, width);
  if (full === width) eighths = 0;

  return {
    fill: "█".repeat(full) + BLOCKS[eighths],
    track: TRACK.repeat(width - full - (eighths > 0 ? 1 : 0)),
  };
}

/** Health level, keyed off the provider's *used* percentage. */
export function level(win) {
  if (win?.status && win.status !== "ok") return "error";
  const used = usedPercent(win);
  if (used === undefined) return "none";
  if (used >= 90) return "error";
  if (used >= 70) return "warn";
  return "ok";
}

/** Right-aligns a short string so percentage columns line up. */
export function alignRight(text, width) {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

/**
 * Compose one quota row into its display pieces. The widget colours each piece
 * with a different theme token, so the layout stays testable without a
 * renderer: `label + fill + track + percent + reset` is the printed line.
 */
export function layoutRow(options) {
  const { label, win, width = 8, labelWidth = 4, percentWidth = 4, now } = options;
  const used = usedPercent(win);
  const parts = bar(used, width);
  const percent = alignRight(used === undefined ? "—" : `${Math.round(used)}%`, percentWidth);
  const reset = countdown(win?.resetsAt, now);

  return {
    label: `${label.padEnd(labelWidth)} `,
    fill: parts.fill,
    track: parts.track,
    percent: `${percent}  `,
    reset: reset ?? "",
  };
}

/** `"4h 17m"`, `"19d 19h"`, `"11h 0m"`, `"now"` or `undefined`. */
export function countdown(resetsAt, now = Date.now()) {
  const target = Date.parse(resetsAt);
  if (!Number.isFinite(target)) return undefined;
  const ms = target - now;
  if (ms <= 0) return "now";

  const minutes = Math.ceil(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * When the plugin will refresh the metrics next — the hint in the block header.
 * Counted from the last poll and the poll interval.
 */
export function refreshInText(lastRefreshAt, now = Date.now(), intervalMs = 60_000) {
  if (!Number.isFinite(lastRefreshAt) || lastRefreshAt <= 0) return undefined;

  const left = Math.max(0, lastRefreshAt + intervalMs - now);
  const seconds = Math.ceil(left / 1000);

  if (seconds < 60) return `refresh in ${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `refresh in ${minutes}m ${String(rest).padStart(2, "0")}s`;
}
