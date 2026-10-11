// Sites Avid has no adapter for: application-form detection and generic matching.
import { test } from "vitest";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [
  "src/shared/schema.js", "src/content/fillers.js", "src/content/generic.js", "src/content/matcher.js",
  "src/content/adapters.js", "src/shared/skills.js", "src/content/engine.js",
].map((p) => fs.readFileSync(path.join(ROOT, p), "utf8"));

function load(name, url = "https://careers.example.com/jobs/123/apply") {
  const html = fs.readFileSync(path.join(ROOT, "test/fixtures/unfamiliar", name), "utf8");
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  const store = {};
  win.chrome = { storage: { local: { async get(k) { return { [k]: store[k] }; }, async set(o) { Object.assign(store, o); } } } };
  win.Element.prototype.getClientRects = () => [{}]; // jsdom has no layout
  for (const src of SCRIPTS) win.eval(src);
  return win;
}
const profile = (A) => {
  const p = structuredClone(A.DEFAULT_PROFILE);
  Object.assign(p.personal, { firstName: "Ada", lastName: "Lovelace", fullName: "Ada Lovelace", email: "ada@example.com", phone: "2025550123", city: "Boston", postalCode: "02110" });
  Object.assign(p.links, { linkedin: "https://linkedin.com/in/ada", github: "https://github.com/ada", portfolio: "https://ada.dev" });
  p.workAuth.requireSponsorship = "No";
  return p;
};

for (const name of ["acme-careers.html", "autocomplete-only.html", "placeholder-table.html"]) {
  test(`${name}: detected as a job application`, () => {
    const win = load(name);
    const r = win.AvidAutofill.generic.detect();
    assert.equal(r.isApplication, true, JSON.stringify(r));
    win.close();
  });
}

for (const name of ["contact-us.html", "login.html", "newsletter.html"]) {
  test(`${name}: not an application`, () => {
    const win = load(name, "https://example.com/page");
    assert.equal(win.AvidAutofill.generic.detect().isApplication, false);
    win.close();
  });
}

test("unfamiliar career page: fields fill from labels, placeholders and bare names", async () => {
  const win = load("acme-careers.html");
  const A = win.AvidAutofill;
  const report = await A.engine.fillPage(profile(A), A.DEFAULT_SETTINGS, null);
  const v = (n) => win.document.querySelector(`[name="${n}"]`).value;
  assert.equal(report.ats, "Generic");
  assert.equal(v("f1"), "Ada");
  assert.equal(v("f2"), "Lovelace");
  assert.equal(v("f3"), "ada@example.com");
  assert.equal(v("f4"), "2025550123");
  assert.equal(v("q_9"), "https://linkedin.com/in/ada");
  assert.equal(v("q_10"), "No");
  win.close();
});

test("autocomplete tokens identify fields with meaningless names", async () => {
  const win = load("autocomplete-only.html");
  const A = win.AvidAutofill;
  await A.engine.fillPage(profile(A), A.DEFAULT_SETTINGS, null);
  const v = (n) => win.document.querySelector(`[name="${n}"]`).value;
  assert.deepEqual([v("x1"), v("x2"), v("x3"), v("x4"), v("x5"), v("x6")], ["Ada", "Lovelace", "ada@example.com", "2025550123", "Boston", "02110"]);
  win.close();
});

test("placeholder-only fields are matched", async () => {
  const win = load("placeholder-table.html");
  const A = win.AvidAutofill;
  await A.engine.fillPage(profile(A), A.DEFAULT_SETTINGS, null);
  const v = (n) => win.document.querySelector(`[name="${n}"]`).value;
  assert.deepEqual([v("n"), v("e"), v("p"), v("w"), v("g")], ["Ada Lovelace", "ada@example.com", "2025550123", "https://ada.dev", "https://github.com/ada"]);
  win.close();
});
