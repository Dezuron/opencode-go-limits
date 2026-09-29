/**
 * OpenCode Go limits — server half.
 *
 * Resolves the `opencode-go` credential through OpenCode's own integration API
 * (the key stays in this process and is never sent to the TUI) and exposes the
 * official usage windows over RPC.
 *
 * Endpoint contract (the same one the web console uses):
 *   GET https://opencode.ai/zen/go/v1/usage
 *   -> { usage: { rolling: {status, percent, resetsAt}, weekly: {...}, monthly: {...} } }
 *   `percent` is the *used* share of the window, matching the console.
 */

import { Plugin } from "@opencode/plugin";
import { GoUsageRpc, type Catalog, type CatalogResult, type Usage, type UsageResult } from "./rpc";
import { debug } from "./debug.mjs";
import { parseLimitsDoc } from "./pricing.mjs";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const PRICING_URL = "https://opencode.ai/docs/go";
const INTEGRATION_ID = "opencode-go";
const FETCH_TIMEOUT_MS = 10_000;
const CATALOG_TTL_MS = 15 * 60 * 1000;

type ResolvedCredential = { type?: string; key?: string } | undefined;

function fail(code: string, error: string): UsageResult {
  debug("server", `fail code=${code} error=${error}`);
  return { error, code };
}

export default Plugin.define({
  id: "go-limits",
  tui: true,
  rpc: true,
  async setup(ctx) {
    debug("server", "setup");

    async function fetchUsage(): Promise<UsageResult> {
      try {
        const connection = await ctx.integration.connection.active(INTEGRATION_ID);
        if (!connection) return fail("no-credential", "Go is not connected");

        const credential = (await ctx.integration.connection.resolve(
          connection,
        )) as ResolvedCredential;
        if (credential?.type !== "key" || !credential.key) {
          return fail("no-credential", "Go credential is not an API key");
        }

        const response = await fetch(USAGE_URL, {
          headers: { Authorization: `Bearer ${credential.key}` },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (response.status === 401) return fail("unauthorized", "Go API key was rejected");
        if (response.status === 403) return fail("not-subscribed", "No active Go subscription");
        if (!response.ok) {
          return fail("http", `Usage request failed (HTTP ${response.status})`);
        }

        const body = (await response.json()) as { usage?: Partial<Usage> };
        const usage = body?.usage;
        if (!usage?.rolling || !usage?.weekly || !usage?.monthly) {
          return fail("bad-response", "Unexpected usage response");
        }

        debug(
          "server",
          `usage ok 5h=${usage.rolling.percent}% weekly=${usage.weekly.percent}% monthly=${usage.monthly.percent}%`,
        );
        return { usage: usage as Usage };
      } catch (error) {
        const reason = error instanceof Error ? error.name : "unknown";
        return fail("network", `Usage request failed (${reason})`);
      }
    }

    let catalogCache: { at: number; catalog: Catalog } | null = null;

    async function loadCatalog(): Promise<CatalogResult> {
      if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
        return {
          catalog: catalogCache.catalog,
          fetchedAt: new Date(catalogCache.at).toISOString(),
        };
      }

      try {
        const response = await fetch(PRICING_URL, {
          headers: { "user-agent": "opencode-go-limits" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          return fail("pricing-fetch", `Pricing page failed (HTTP ${response.status})`);
        }

        const catalog = parseLimitsDoc(await response.text()) as Catalog;
        if (!catalog.plans?.go?.length) {
          return fail("pricing-parse", "Pricing page had no models");
        }

        catalogCache = { at: Date.now(), catalog };
        debug(
          "server",
          `catalog go=${catalog.plans.go.length} plus=${catalog.plans.plus?.length ?? 0}`,
        );
        return { catalog, fetchedAt: new Date(catalogCache.at).toISOString() };
      } catch (error) {
        const reason = error instanceof Error ? error.name : "unknown";
        return fail("pricing-fetch", `Pricing page unreachable (${reason})`);
      }
    }

    await ctx.rpc.register(GoUsageRpc, {
      get: () => fetchUsage(),
      catalog: () => loadCatalog(),
    });
  },
});
