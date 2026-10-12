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
  "src/content/adapters.js", "src/shared/skills.js", "src/content/repeaters.js", "src/content/engine.js",
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

test("a video site is not an application and does not match a platform by its CSS-module classes", () => {
  const win = load("video-site.html", "https://videos.example.com/watch?v=abc");
  const A = win.AvidAutofill;
  assert.equal(A.generic.detect().isApplication, false);
  assert.equal(A.adapters.detect().name, "Generic");
  win.close();
});

test("a generic #application_form id on another host must still look like an application", () => {
  const win = load("video-site.html", "https://videos.example.com/watch?v=abc");
  win.document.body.insertAdjacentHTML("beforeend", '<form id="application_form"><input name="q"></form>');
  const A = win.AvidAutofill;
  const adapter = A.adapters.detect();
  assert.equal(adapter.name, "Greenhouse");
  assert.equal(A.adapters.markupOnly(adapter), true);
  assert.equal(A.generic.detect().isApplication, false);
  win.close();
});

test("only a field's own label, not surrounding text, counts toward application detection", () => {
  const win = load("video-site.html", "https://videos.example.com/jobs/apply");
  win.document.body.innerHTML = '<div>Name Email Phone Resume<input name="x" placeholder="Search"><input name="y" placeholder="Filter"></div>';
  assert.equal(win.AvidAutofill.generic.detect().isApplication, false);
  win.close();
});

test("repeating work rows: one job per row, jobs already listed are skipped, missing ones get a new row", async () => {
  const win = load("repeating-rows.html");
  const A = win.AvidAutofill;
  const doc = win.document;
  // Emulate the site's "add another": copy the hidden template row.
  let added = 0;
  doc.querySelector("#work .add").addEventListener("click", (e) => {
    e.preventDefault();
    const row = doc.querySelector("#work .sample").cloneNode(true);
    row.classList.remove("sample");
    row.removeAttribute("aria-hidden");
    added++;
    for (const el of row.querySelectorAll("[id], [for]")) {
      for (const at of ["id", "name", "for"]) if (el.getAttribute(at)) el.setAttribute(at, el.getAttribute(at).replace("-s-", `-n${added}-`));
    }
    setTimeout(() => doc.querySelector("#work .rows").appendChild(row), 50);
  });
  const p = profile(A);
  p.work = [
    { company: "Globex", title: "Engineer", startDate: "Mar 2023", endDate: "Present", current: true, description: "" },
    { company: "Hooli", title: "Developer", startDate: "Jan 2021", endDate: "Feb 2023", current: false, description: "" },
    { company: "Initech", title: "Analyst", startDate: "Jan 2019", endDate: "Dec 2020", current: false, description: "" },
  ];
  p.education = [{ school: "MIT", degree: "BS", field: "Computer Science", startDate: "", endDate: "May 2018", gpa: "" }];
  await A.engine.fillPage(p, A.DEFAULT_SETTINGS, null);
  const v = (id) => doc.getElementById(id).value;
  // Initech was already on the form and stays as it was.
  assert.equal(v("w-0-1"), "Initech");
  // The empty row takes the first job not yet listed.
  assert.equal(v("w-1-1"), "Globex");
  assert.equal(v("w-1-2"), "Engineer");
  assert.equal(v("w-1-3"), "Yes");
  assert.equal(v("w-1-4"), "2023-03");
  assert.equal(v("w-1-5"), "");
  // Hooli had no row, so one was added for it.
  assert.equal(added, 1);
  assert.equal(v("w-n1-1"), "Hooli");
  assert.equal(v("w-n1-3"), "No");
  assert.equal(v("w-n1-5"), "2023-02");
  // The hidden template row is never filled.
  assert.equal(v("w-s-1"), "");
  // Education: "BS" is listed as "Bachelor's Degree".
  assert.equal(v("e-0-1"), "MIT");
  assert.equal(v("e-0-2"), "Bachelor's Degree");
  assert.equal(v("e-0-3"), "Computer Science");
  win.close();
});
