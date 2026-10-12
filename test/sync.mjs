// Profile sync through chrome.storage.sync (src/shared/profile-sync.js).
import { test } from "vitest";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = ["src/shared/schema.js", "src/shared/profile-sync.js"].map((p) => fs.readFileSync(path.join(ROOT, p), "utf8"));

const area = (store) => ({
  async get(k) {
    if (k == null) return { ...store };
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
  },
  async set(o) {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith("avidSync:") && JSON.stringify(k).length + JSON.stringify(v).length > 8192) throw new Error("QUOTA_BYTES_PER_ITEM");
      store[k] = structuredClone(v);
    }
  },
  async remove(k) { for (const x of [].concat(k)) delete store[x]; },
});

// One browser: its own local storage, and the sync storage shared by all of them.
function device(shared) {
  const win = new JSDOM("", { runScripts: "outside-only" }).window;
  const local = {};
  win.chrome = { storage: { local: area(local), sync: area(shared) } };
  for (const src of SCRIPTS) win.eval(src);
  return { A: win.AvidAutofill, local };
}
const profile = (A, name, extra = {}) => {
  const p = structuredClone(A.DEFAULT_PROFILE);
  Object.assign(p.personal, { fullName: name, email: `${name.toLowerCase()}@example.com` }, extra);
  return p;
};

test("a profile pushed from one browser arrives in another", async () => {
  const shared = {};
  const one = device(shared), two = device(shared);
  await one.A.saveProfile(profile(one.A, "Ada"));
  assert.equal((await one.A.profileSync.enable()).needsChoice, false);
  // The second browser has nothing yet, so turning sync on takes the synced copy.
  assert.equal((await two.A.profileSync.enable()).needsChoice, false);
  assert.equal((await two.A.getProfile()).personal.fullName, "Ada");
  // A later edit on the first browser reaches the second.
  await one.A.saveProfile(profile(one.A, "Ada", { city: "Boston" }));
  await one.A.profileSync.push(await one.A.getProfile());
  assert.equal(await two.A.profileSync.pull(), true);
  assert.equal((await two.A.getProfile()).personal.city, "Boston");
  // Pulling the same copy again changes nothing.
  assert.equal(await two.A.profileSync.pull(), false);
});

test("two different profiles ask which one to keep", async () => {
  const shared = {};
  const one = device(shared), two = device(shared);
  await one.A.saveProfile(profile(one.A, "Ada"));
  await one.A.profileSync.enable();
  await two.A.saveProfile(profile(two.A, "Grace"));
  assert.equal((await two.A.profileSync.enable()).needsChoice, true);
  assert.equal((await two.A.profileSync.getState()).enabled, false);
  await two.A.profileSync.enable("local");
  assert.equal(await one.A.profileSync.pull(), true);
  assert.equal((await one.A.getProfile()).personal.fullName, "Grace");
});

test("a large profile is split under Chrome's per-item limit, and shrinking it removes old parts", async () => {
  const shared = {};
  const one = device(shared), two = device(shared);
  const big = profile(one.A, "Ada");
  big.work = Array.from({ length: 12 }, (_, i) => ({ company: `Co${i}`, title: "Engineer", description: "é".repeat(3000) }));
  await one.A.saveProfile(big);
  await one.A.profileSync.enable();
  const parts = Object.keys(shared).filter((k) => /^avidSync:\d+$/.test(k)).length;
  assert.ok(parts > 1);
  await two.A.profileSync.enable();
  assert.equal((await two.A.getProfile()).work.length, 12);
  await one.A.saveProfile(profile(one.A, "Ada"));
  await one.A.profileSync.push(await one.A.getProfile());
  assert.equal(Object.keys(shared).filter((k) => /^avidSync:\d+$/.test(k)).length, 1);
});

test("the resume and this browser's import details never sync", async () => {
  const shared = {};
  const one = device(shared);
  const p = profile(one.A, "Ada");
  p.meta = { importedAt: "2026-01-01", source: "resume.pdf" };
  await one.A.saveProfile(p);
  await one.A.saveResume({ name: "cv.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,AAAA" });
  await one.A.profileSync.enable();
  const text = Object.entries(shared).filter(([k]) => /^avidSync:\d+$/.test(k)).map(([, v]) => v).join("");
  assert.ok(!text.includes("base64"));
  assert.ok(!text.includes("resume.pdf"));
});

test("a half-written copy is ignored until its parts match", async () => {
  const shared = {};
  const one = device(shared), two = device(shared);
  await one.A.saveProfile(profile(one.A, "Ada"));
  await one.A.profileSync.enable();
  await two.A.profileSync.enable();
  shared["avidSync:0"] = shared["avidSync:0"].replace("Ada", "Bob");
  assert.equal(await two.A.profileSync.pull(), false);
  assert.equal((await two.A.getProfile()).personal.fullName, "Ada");
});
