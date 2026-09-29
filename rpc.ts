/**
 * RPC contract between the server half (`index.ts`) and the TUI half
 * (`tui.tsx`). The API key never crosses this boundary — only percentages and
 * reset timestamps do.
 *
 * The window schemas are deliberately permissive: the provider is free to add
 * or drop fields without turning a quota reading into a validation failure.
 * The TUI renders whatever is present and shows "—" for what is missing.
 */

import { Rpc } from "@opencode/plugin/rpc";

export type UsageWindow = {
  status: string;
  percent: number;
  resetsAt: string;
};

export type Usage = {
  rolling: UsageWindow;
  weekly: UsageWindow;
  monthly: UsageWindow;
};

export type UsageResult = {
  usage?: Usage;
  error?: string;
  /** Stable machine-readable reason, used by the TUI to hide expected states. */
  code?: string;
};

export type CatalogModel = {
  key: string;
  name: string;
  /** Estimated requests per month the model offers right now (promo value). */
  monthly: number | null;
  /** The value the monthly limit falls back to once the promo ends. */
  baseMonthly: number | null;
  /** True when the docs call the model Unlimited (free, limited-time). */
  unlimited?: boolean;
  promo: { label: string; multiplier: number | null; endsAt: string | null } | null;
};

/** OpenCode Go tariffs. `plus` is the higher-usage tier. */
export type PlanName = "go" | "plus";

export type Catalog = {
  /** Both tariffs as published on docs/go; `plus` is null when the page has one table. */
  plans: {
    go: CatalogModel[];
    plus: CatalogModel[] | null;
  };
};

export type CatalogResult = {
  catalog?: Catalog;
  fetchedAt?: string;
  error?: string;
  code?: string;
};

const windowSchema = {
  type: "object",
  properties: {
    status: { type: "string" },
    percent: { type: "number" },
    resetsAt: { type: "string" },
  },
};

const usageSchema = {
  type: "object",
  properties: {
    rolling: windowSchema,
    weekly: windowSchema,
    monthly: windowSchema,
  },
  required: ["rolling", "weekly", "monthly"],
};

export const GoUsageRpc = Rpc.define({
  id: "go-limits",
  methods: {
    get: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          usage: usageSchema,
          error: { type: "string" },
          code: { type: "string" },
        },
      },
    },
    // Pricing/limits catalog parsed from the public docs page. The payload is
    // shaped by pricing.mjs and kept as a loose object on purpose: the page can
    // gain columns without breaking the RPC contract.
    catalog: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          catalog: { type: "object" },
          fetchedAt: { type: "string" },
          error: { type: "string" },
          code: { type: "string" },
        },
      },
    },
  },
  events: {},
});
