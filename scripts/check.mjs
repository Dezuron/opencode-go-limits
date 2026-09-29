// Transpile check: strips types and compiles JSX exactly the way OpenCode does
// at load time, so a syntax error surfaces here instead of silently killing the
// widget. Run: bun run check
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  { file: "index.ts", loader: "ts" },
  { file: "rpc.ts", loader: "ts" },
  { file: "tui.tsx", loader: "tsx" },
];

let failed = false;
for (const { file, loader } of entries) {
  const source = await Bun.file(join(root, file)).text();
  try {
    const output = new Bun.Transpiler({ loader }).transformSync(source);
    console.log(`ok   ${file} (${output.length} bytes transpiled)`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${file}: ${error?.message ?? error}`);
  }
}

// The plain-ESM helpers must import cleanly under Node as well.
const format = await import(new URL("../format.mjs", import.meta.url).href);
console.log(`ok   format.mjs exports: ${Object.keys(format).join(", ")}`);
const pricing = await import(new URL("../pricing.mjs", import.meta.url).href);
console.log(`ok   pricing.mjs exports: ${Object.keys(pricing).join(", ")}`);
const pending = await import(new URL("../pending.mjs", import.meta.url).href);
console.log(`ok   pending.mjs exports: ${Object.keys(pending).join(", ")}`);
const state = await import(new URL("../state.mjs", import.meta.url).href);
console.log(`ok   state.mjs exports: ${Object.keys(state).join(", ")}`);
const plan = await import(new URL("../plan.mjs", import.meta.url).href);
console.log(`ok   plan.mjs exports: ${Object.keys(plan).join(", ")}`);
const debugModule = await import(new URL("../debug.mjs", import.meta.url).href);
console.log(`ok   debug.mjs exports: ${Object.keys(debugModule).join(", ")}`);

process.exit(failed ? 1 : 0);
