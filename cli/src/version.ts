// Single source of truth for the CLI/MCP version: read it from package.json at
// runtime so we never hand-maintain a version constant that drifts out of sync.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATHS = [
  // From src/ via tsx: cli/src/ → cli/package.json
  resolve(SRC_DIR, "..", "package.json"),
  // From dist/ compiled: cli/dist/ → cli/package.json
  resolve(SRC_DIR, "..", "..", "package.json")
];

function readVersion(): string {
  for (const path of CANDIDATE_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return "0.0.0";
}

export const VERSION = readVersion();
