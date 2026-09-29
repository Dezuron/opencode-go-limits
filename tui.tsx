/**
 * OpenCode Go limits — TUI half.
 *
 * Everything lives in the session sidebar (the same column that lists MCP
 * servers):
 *   - the 5h / weekly / monthly quota windows, refreshed over RPC every minute;
 *   - the tariff the numbers belong to (Go / Go Plus), switched by clicking the
 *     header;
 *   - the model the session is using and its monthly request limit, red when it
 *     falls below LOW_MONTHLY_REQUESTS;
 *   - a collapsible list of the models that do meet that threshold, so a
 *     too-limited model can be swapped for a better one right away.
 *
 * This file never touches the API key.
 */

/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import {
  GoUsageRpc,
  type Catalog,
  type PlanName,
  type Usage,
  type UsageResult,
} from "./rpc";
import { WINDOWS, layoutRow, level, refreshInText } from "./format.mjs";
import { pendingHint, readPendingModel } from "./pending.mjs";
import {
  effectiveMonthly,
  findModel,
  formatCount,
  formatModelListRow,
  promoStatus,
  promoText,
  qualifyingModels,
} from "./pricing.mjs";
import { otherPlan, readPlan, writePlan } from "./plan.mjs";
import { debug } from "./debug.mjs";

const REFRESH_INTERVAL_MS = 60_000;
const CATALOG_INTERVAL_MS = 15 * 60 * 1000;
const PENDING_INTERVAL_MS = 5_000;
const BAR_WIDTH = 8;
const LABEL_WIDTH = 4;
const PERCENT_WIDTH = 4;
const MODEL_NAME_WIDTH = 20;
const GO_PROVIDER_ID = "opencode-go";

/** A model offering fewer estimated requests per month than this is flagged. */
const LOW_MONTHLY_REQUESTS = 80_000;

/** Errors that mean "no Go subscription on this machine" — hide quietly. */
const QUIET_ERROR_CODES = new Set(["no-credential", "not-subscribed"]);

type Snapshot = {
  usage?: Usage;
  error?: string;
  code?: string;
  stale: boolean;
};

type SessionModel = { providerID?: string; id?: string } | undefined;

type WindowKey = (typeof WINDOWS)[number]["key"];

function planLabel(plan: PlanName) {
  return plan === "plus" ? "Go Plus" : "Go";
}

/** The block title: `Go quota` / `Go Plus quota`. */
function quotaLabel(plan: PlanName) {
  return plan === "plus" ? "Go Plus quota" : "Go quota";
}

function Row(props: { label: string; win: Usage[WindowKey] | undefined }) {
  const ctx = usePlugin();
  const parts = () =>
    layoutRow({
      label: props.label,
      win: props.win,
      width: BAR_WIDTH,
      labelWidth: LABEL_WIDTH,
      percentWidth: PERCENT_WIDTH,
    });
  const tone = () => {
    switch (level(props.win)) {
      case "error":
        return ctx.theme.text.feedback.error.base;
      case "warn":
        return ctx.theme.text.feedback.warning.base;
      case "none":
        return ctx.theme.text.muted;
      default:
        return ctx.theme.text.feedback.success.base;
    }
  };

  // Reactive on purpose: the rows must redraw on every poll. Solid runs a
  // component body once, so layoutRow has to be called from JSX or an effect,
  // never from the body (the row would freeze at mount otherwise).
  createEffect(() => {
    const row = parts();
    debug("tui", `row |${row.label}${row.fill}${row.track} ${row.percent}${row.reset}|`);
  });

  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={ctx.theme.text.muted} wrapMode="none">
        {parts().label}
      </text>
      <text fg={tone()} wrapMode="none">
        {parts().fill}
      </text>
      <text fg={ctx.theme.text.muted} wrapMode="none">
        {`${parts().track} `}
      </text>
      <text fg={tone()} wrapMode="none">
        {parts().percent}
      </text>
      <text fg={ctx.theme.text.muted} wrapMode="none">
        {parts().reset}
      </text>
    </box>
  );
}

/**
 * The model block: the model the session is on (or the one just picked in the
 * picker, marked as pending) and its monthly request limit. Red below threshold.
 */
function ModelLine(props: {
  models: () => Catalog["plans"]["go"];
  model: () => SessionModel;
  pending: () => SessionModel;
}) {
  const ctx = usePlugin();
  const hint = () => pendingHint(props.model(), props.pending());
  const shown = () => hint() ?? props.model();
  const entry = () => findModel(props.models(), shown()?.id);
  const monthly = () => effectiveMonthly(entry());
  const low = () => monthly() !== null && monthly() < LOW_MONTHLY_REQUESTS;
  const status = () => promoStatus(entry()?.promo, new Date());
  const name = () => entry()?.name ?? shown()?.id;
  // `Unlimited` is not a count, so it gets a word instead of "≈Infinity req/mo".
  const limit = () => {
    if (entry()?.unlimited) return "unlimited";
    const value = monthly();
    return value === null ? undefined : `≈${formatCount(value)} req/mo`;
  };
  // Reactive marker: logs every time the block actually changes on screen.
  createEffect(() => {
    debug(
      "tui",
      `model render ${name() ?? "-"} limit=${limit() ?? "-"} low=${low()} pending=${hint() ? "yes" : "no"}`,
    );
  });

  return (
    <Show when={name()}>
      <box flexDirection="column" flexShrink={0}>
        <text fg={low() ? ctx.theme.text.feedback.error.base : ctx.theme.text.base} wrapMode="none">
          {name() ?? ""}
        </text>
        <Show when={limit()}>
          <text
            fg={low() ? ctx.theme.text.feedback.error.base : ctx.theme.text.muted}
            wrapMode="none"
          >
            {limit() ?? ""}
          </text>
        </Show>
        <Show when={hint()}>
          <text fg={ctx.theme.text.feedback.warning.base} wrapMode="none">
            {"selected, applies on next request"}
          </text>
        </Show>
        <Show when={status().active}>
          <text
            fg={status().endsSoon ? ctx.theme.text.feedback.warning.base : ctx.theme.text.muted}
            wrapMode="none"
          >
            {promoText(entry()?.promo, status())}
          </text>
        </Show>
      </box>
    </Show>
  );
}

/** Collapsible list of models meeting the threshold, most generous first. */
function ModelList(props: { models: () => Catalog["plans"]["go"] }) {
  const ctx = usePlugin();
  const [expanded, setExpanded] = createSignal(true);
  const rows = () => qualifyingModels(props.models(), LOW_MONTHLY_REQUESTS, new Date());
  // Also in an effect: otherwise the log would show one line per mount.
  createEffect(() => debug("tui", `alternatives=${rows().length}`));

  return (
    <Show when={rows().length > 0}>
      <box flexDirection="column" flexShrink={0}>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded((value) => !value)}>
          <text fg={ctx.theme.text.base} wrapMode="none">
            {expanded() ? "▼" : "▶"}
          </text>
          <text fg={ctx.theme.text.muted} wrapMode="none">
            {`meet threshold ≥${formatCount(LOW_MONTHLY_REQUESTS)} (${rows().length})`}
          </text>
        </box>
        <Show when={expanded()}>
          <For each={rows()}>
            {(row) => (
              <text fg={ctx.theme.text.muted} wrapMode="none">
                {`  ${formatModelListRow(row.name, row.monthly, {
                  nameWidth: MODEL_NAME_WIDTH,
                  unlimited: row.unlimited,
                })}`}
              </text>
            )}
          </For>
        </Show>
      </box>
    </Show>
  );
}

function GoQuota(props: {
  snapshot: () => Snapshot;
  catalog: () => Catalog | undefined;
  pending: () => SessionModel;
  sessionID: () => string | undefined;
  /** When the last poll happened — the next one is counted from it. */
  lastRefresh: () => number;
  /** Ticks once a second so the countdown stays live on screen. */
  now: () => number;
  plan: () => PlanName;
  planHint: () => boolean;
  onTogglePlan: () => void;
}) {
  const ctx = usePlugin();
  const [model, setModel] = createSignal<SessionModel>();
  let generation = 0;

  async function syncModel(sessionID: string | undefined, reason: string) {
    const current = ++generation;
    if (!sessionID) {
      setModel(undefined);
      return;
    }
    try {
      // The store keeps its own cache; drop it so the refetch is authoritative.
      ctx.data.session.invalidate(sessionID);
      await ctx.data.session.sync(sessionID);
      if (current !== generation) return;
      const found = ctx.data.session.get(sessionID)?.model as SessionModel;
      debug("tui", `model sync(${reason}) ${found?.id ?? "-"}`);
      setModel(found);
    } catch (error) {
      const reasonText = error instanceof Error ? error.message : String(error);
      debug("tui", `model sync(${reason}) failed: ${reasonText}`);
      if (current === generation) setModel(undefined);
    }
  }

  // Primary source of truth: the TUI store itself, read reactively. Whatever
  // updated it — the model picker, the event reducer, another view — the block
  // follows immediately.
  createEffect(() => {
    const sessionID = props.sessionID();
    const fromStore = sessionID
      ? (ctx.data.session.get(sessionID)?.model as SessionModel)
      : undefined;
    if (!fromStore) return;
    debug("tui", `model store ${fromStore.id ?? "-"}`);
    setModel(fromStore);
  });

  // Fallback poll: the model can change without the store notifying a plugin.
  createEffect(() => {
    props.snapshot();
    void syncModel(props.sessionID(), "poll");
  });

  // Model switches arrive with the new model in the event payload — take it
  // straight from there, before the store round-trip.
  onCleanup(
    ctx.data.on("session.model.selected", (event) => {
      if (event.data.sessionID !== props.sessionID()) return;
      const selected = event.data.model as SessionModel;
      debug("tui", `model event ${selected?.id ?? "-"}`);
      generation += 1;
      setModel(selected);
    }),
  );

  const usage = () => props.snapshot().usage;
  const models = () => props.catalog()?.plans?.[props.plan()] ?? [];
  const isGoSession = () =>
    model()?.providerID === GO_PROVIDER_ID || props.pending()?.providerID === GO_PROVIDER_ID;
  const quiet = () => {
    const snapshot = props.snapshot();
    return !snapshot.usage && snapshot.code !== undefined && QUIET_ERROR_CODES.has(snapshot.code);
  };
  const visible = () => !quiet() && (usage() !== undefined || props.snapshot().error !== undefined);
  // Reactive on purpose: a Solid component body runs once, so a plain
  // debug(...) here would only show the state at mount time.
  createEffect(() => {
    debug(
      "tui",
      `render visible=${visible()} usage=${usage() ? "yes" : "no"} refresh=${refreshInText(props.lastRefresh(), props.now(), REFRESH_INTERVAL_MS) ?? "-"} plan=${props.plan()} models=${models().length} model=${model()?.id ?? "-"}`,
    );
  });

  return (
    <Show when={visible()}>
      <box flexDirection="column" flexShrink={0} paddingBottom={1}>
        <box flexDirection="column" flexShrink={0}>
          <box flexDirection="row" flexShrink={0} onMouseDown={props.onTogglePlan}>
            <text fg={ctx.theme.text.muted} wrapMode="none">
              {`● ${quotaLabel(props.plan())}`}
            </text>
            <Show when={refreshInText(props.lastRefresh(), props.now(), REFRESH_INTERVAL_MS)}>
              <text fg={ctx.theme.text.muted} wrapMode="none">
                {` · ${refreshInText(props.lastRefresh(), props.now(), REFRESH_INTERVAL_MS)}`}
              </text>
            </Show>
            <Show when={props.snapshot().stale}>
              <text fg={ctx.theme.text.feedback.error.base} wrapMode="none">
                {" (stale)"}
              </text>
            </Show>
          </box>
          <Show when={props.planHint()}>
            <text fg={ctx.theme.text.muted} wrapMode="none">
              {`click to switch to ${planLabel(otherPlan(props.plan()) as PlanName)}`}
            </text>
          </Show>
        </box>
        <Show when={usage()}>
          <For each={WINDOWS}>
            {(entry) => (
              <Row
                label={entry.label}
                win={usage() === undefined ? undefined : usage()[entry.key]}
              />
            )}
          </For>
        </Show>
        <Show when={usage() === undefined && props.snapshot().error !== undefined}>
          <text fg={ctx.theme.text.feedback.error.base} wrapMode="none">
            {`  ${props.snapshot().error}`}
          </text>
        </Show>
        <Show when={isGoSession()}>
          <ModelLine models={models} model={model} pending={props.pending} />
          <ModelList models={models} />
        </Show>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "go-limits.tui",
  setup(context) {
    debug("tui", `setup interval=${REFRESH_INTERVAL_MS}ms catalog=${CATALOG_INTERVAL_MS}ms`);
    const rpc = context.client.rpc(GoUsageRpc);
    const [snapshot, setSnapshot] = createSignal<Snapshot>({ stale: false });
    const [catalog, setCatalog] = createSignal<Catalog>();
    const [pending, setPending] = createSignal<SessionModel>();
    // The last poll and the current time: the "refresh in Ns" countdown is
    // derived from them.
    const [lastRefresh, setLastRefresh] = createSignal(0);
    const [now, setNow] = createSignal(Date.now());
    // Tariff: a stored user choice, not a guess — no API exposes it.
    const [plan, setPlan] = createSignal<PlanName>("go");
    const [planChosen, setPlanChosen] = createSignal(false);

    async function loadPlan() {
      const saved = await readPlan();
      setPlan(saved.plan as PlanName);
      setPlanChosen(saved.source !== "default");
      debug("tui", `plan ${saved.plan} source=${saved.source}`);
    }

    const canSwitch = () => Boolean(catalog()?.plans?.plus);
    function togglePlan() {
      if (!canSwitch()) return;
      const next = otherPlan(plan()) as PlanName;
      setPlan(next);
      setPlanChosen(true);
      debug("tui", `plan switch ${next}`);
      void writePlan(next);
    }

    // The picker only commits the model on the next prompt, so watch the TUI's
    // own state file for the model that was just picked.
    async function readPending() {
      const found = await readPendingModel();
      setPending((previous) => {
        if (previous?.id === found?.id && previous?.providerID === found?.providerID) {
          return previous; // unchanged: keep the signal stable, no re-render
        }
        debug("tui", `pending ${found?.providerID ?? "-"}/${found?.id ?? "-"}`);
        return found;
      });
    }

    async function refreshUsage() {
      setLastRefresh(Date.now());
      try {
        const result = (await rpc.get({})) as UsageResult;
        if (result?.usage) {
          debug(
            "tui",
            `refresh ok 5h=${result.usage.rolling?.percent}% weekly=${result.usage.weekly?.percent}% monthly=${result.usage.monthly?.percent}%`,
          );
          setSnapshot({ usage: result.usage, stale: false });
          return;
        }
        debug("tui", `refresh error code=${result?.code ?? "unknown"} error=${result?.error ?? "-"}`);
        setSnapshot((previous) => ({
          usage: previous.usage,
          error: result?.error,
          code: result?.code,
          stale: previous.usage !== undefined,
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        debug("tui", `refresh threw ${reason}`);
        setSnapshot((previous) => ({
          usage: previous.usage,
          error: previous.error ?? "Usage request failed",
          code: previous.code,
          stale: previous.usage !== undefined,
        }));
      }
    }

    async function refreshCatalog() {
      try {
        const result = (await rpc.catalog({})) as CatalogResult;
        if (result?.catalog) {
          debug(
            "tui",
            `catalog ok go=${result.catalog.plans.go.length} plus=${result.catalog.plans.plus?.length ?? 0}`,
          );
          setCatalog(result.catalog);
          return;
        }
        debug("tui", `catalog error code=${result?.code ?? "unknown"} error=${result?.error ?? "-"}`);
      } catch (error) {
        debug("tui", `catalog threw ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    void refreshUsage();
    void refreshCatalog();
    void readPending();
    void loadPlan();
    const usageTimer = setInterval(() => void refreshUsage(), REFRESH_INTERVAL_MS);
    const catalogTimer = setInterval(() => void refreshCatalog(), CATALOG_INTERVAL_MS);
    const pendingTimer = setInterval(() => void readPending(), PENDING_INTERVAL_MS);
    // One-second tick: drives the "refresh in Ns" countdown.
    const clockTimer = setInterval(() => setNow(Date.now()), 1_000);

    const unregisterSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => (
        <GoQuota
          snapshot={snapshot}
          catalog={catalog}
          pending={pending}
          sessionID={() => input.sessionID}
          lastRefresh={lastRefresh}
          now={now}
          plan={plan}
          planHint={() => !planChosen() && canSwitch()}
          onTogglePlan={togglePlan}
        />
      ),
    });

    return () => {
      debug("tui", "dispose");
      clearInterval(usageTimer);
      clearInterval(catalogTimer);
      clearInterval(pendingTimer);
      clearInterval(clockTimer);
      unregisterSidebar();
    };
  },
});
