// Unit-test runner: auto-discovers every *.test.ts file in this directory,
// imports it (registering its cases with the harness), then runs them all.
// Offline only — these tests must NOT hit the network (that's smoke.ts's job).
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "./_harness.js";

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

console.log(`gaokao-pro unit tests (${files.length} file${files.length === 1 ? "" : "s"})`);

for (const f of files) {
  await import(resolve(dir, f));
}

const failed = await runAll();
if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nall unit tests passed");
