// اجرای همه‌ی تست‌ها:  node tests/run-all.mjs   (یا: npm test داخل پوشه‌ی tests)
import { spawnSync } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);

const steps = [
  ["node", ["build.mjs"]],
  ["node", ["shipments.test.mjs"]],
  ["node", ["payments.test.mjs"]],
  ["node", ["admin-panel.test.cjs"]],
  ["node", ["seo.test.mjs"]],
  ["node", ["content.test.mjs"]],
];

let failed = 0;

for (const [cmd, args] of steps) {
  const label = args[0];
  console.log(`\n════════ ${label} ════════`);

  const res = spawnSync(cmd, args, {
    cwd: here,
    stdio: "inherit",
    env: process.env,
  });

  if (res.status !== 0) {
    failed++;
    console.error(`✗ ${label} failed (exit ${res.status})`);
  }
}

console.log(
  failed === 0
    ? "\nهمه‌ی تست‌ها پاس شدند ✅"
    : `\n${failed} تست با شکست تمام شد ❌`
);

process.exit(failed === 0 ? 0 : 1);
