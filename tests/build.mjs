// فانکشن‌های Edge را برای تست در Node باندل می‌کند.
// ایمپورت supabase-js با stub درون‌حافظه‌ای جایگزین و Deno.env شبیه‌سازی می‌شود.
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const outDir = path.join(here, ".build");

mkdirSync(outDir, { recursive: true });

const FUNCTIONS = ["admin-shipments", "payment-request", "payment-verify"];

for (const name of FUNCTIONS) {
  const src = path.join(root, "supabase", "functions", name, "index.ts");
  const tmp = path.join(outDir, `${name}.src.ts`);

  writeFileSync(
    tmp,
    readFileSync(src, "utf8").replace(
      "https://esm.sh/@supabase/supabase-js@2",
      "./../supabase-stub.js"
    ),
    "utf8"
  );

  await esbuild.build({
    entryPoints: [tmp],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: path.join(outDir, `${name}.mjs`),
    inject: [path.join(here, "deno-shim.js")],
    external: ["./../supabase-stub.js"],
  });
}

console.log(`bundled ${FUNCTIONS.length} edge functions → tests/.build/`);
