// The jsdom suites read source files directly, so a script that no entrypoint
// imports passes every test yet never ships. Every extension script must be
// imported by a file in src/entrypoints.
import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = ["src/background", "src/content", "src/options", "src/shared"];

function filesUnder(dir, ext) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(rel, ext) : rel.endsWith(ext) ? [rel] : [];
  });
}

test("every extension script is imported by an entrypoint", () => {
  const imported = new Set();
  for (const entry of filesUnder("src/entrypoints", ".ts")) {
    const source = fs.readFileSync(path.join(ROOT, entry), "utf8");
    for (const [, spec] of source.matchAll(/^import\s+(?:[^"']*\sfrom\s+)?["'](\.[^"']+)["']/gm)) {
      imported.add(path.relative(ROOT, path.resolve(ROOT, path.dirname(entry), spec)));
    }
  }
  const missing = SHIPPED.flatMap((dir) => filesUnder(dir, ".js")).filter((file) => !imported.has(file));
  assert.deepEqual(missing, [], "add these to an entrypoint in src/entrypoints");
});

test("the manifest comes from wxt.config.ts, not a checked-in manifest.json", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "manifest.json")), false, "move its changes into wxt.config.ts or an entrypoint");
});
