// Fill checks against saved-form layouts from other hiring sites (iCIMS, Taleo,
// Jobvite, BambooHR, Breezy, Recruitee, JazzHR, Teamtailor, Paylocity). These
// are hand-built to match each site's markup, not captures, so they pin down
// the layout patterns (table rows, label-less placeholders, question spans)
// rather than any one company's form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = ["src/shared/schema.js", "src/popup/target.js", "src/content/fillers.js", "src/content/matcher.js", "src/content/adapters.js", "src/shared/skills.js", "src/content/workday.js", "src/content/engine.js"]
  .map((p) => fs.readFileSync(path.join(ROOT, p), "utf8"));

async function fill(html, url) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url });
  const win = dom.window, store = {};
  win.chrome = { storage: { local: { async get(k) { return k == null ? { ...store } : { [k]: store[k] }; }, async set(o) { Object.assign(store, o); }, async remove(k) { delete store[k]; } } } };
  for (const src of SCRIPTS) win.eval(src);
  win.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }];
  const A = win.AvidAutofill;
  A.fillers.sleep = async () => {};
  const profile = A.mergeDefaults(A.DEFAULT_PROFILE, {
    personal: { firstName: "Alex", lastName: "Rivera", fullName: "Alex Rivera", email: "alex.rivera@example.com", phone: "5551230000", address: "1 Market Street", city: "Portland", state: "CA", postalCode: "94016", country: "United States" },
    links: { linkedin: "https://linkedin.com/in/alexrivera" },
    work: [{ company: "Globex", title: "Software Engineer" }],
    workAuth: { authorizedToWork: "Yes", requireSponsorship: "No" },
  });
  const report = await A.engine.fillPage(profile, A.DEFAULT_SETTINGS, null);
  return { report, doc: win.document, close: () => win.close() };
}
const site = (name) => fs.readFileSync(path.join(ROOT, "test/fixtures/sites", `${name}.html`), "utf8");

const CASES = [
  { name: "icims", url: "https://careers-acme.icims.com/jobs/1/job/login", ats: "iCIMS", values: { First_Name_Field: "Alex", Email_Field: "alex.rivera@example.com", Phone_Field: "5551230000", Addr1: "1 Market Street", City_Field: "Portland", State_Field: "California", Zip_Field: "94016", Country_Field: "United States", Auth: "Yes", Spons: "No" } },
  { name: "taleo", url: "https://acme.taleo.net/careersection/2/jobapply.ftl", ats: "Taleo", values: { f2: "Rivera", f3: "alex.rivera@example.com", f4: "5551230000", f5: "Portland", f6: "94016", f7: "United States", f8: "California", f9: "https://linkedin.com/in/alexrivera" } },
  { name: "jobvite", url: "https://jobs.jobvite.com/acme/job/oX/apply", ats: "Jobvite", values: { "jv-first": "Alex", "jv-email": "alex.rivera@example.com", "jv-loc": "Portland", "jv-co": "Globex" }, radios: { auth: "yes" }, unchecked: ['input[name="alerts"]'] },
  { name: "bamboohr", url: "https://acme.bamboohr.com/careers/12", ats: "BambooHR", values: { firstName: "Alex", streetAddress: "1 Market Street", state: "CA", zip: "94016", linkedinUrl: "https://linkedin.com/in/alexrivera", q1: "Yes", q2: "No" } },
  { name: "breezy", url: "https://acme.breezy.hr/p/abc-engineer", ats: "Breezy", values: {}, byName: { cName: "Alex Rivera", cEmail: "alex.rivera@example.com", cAddress: "1 Market Street", cLinkedIn: "https://linkedin.com/in/alexrivera" } },
  { name: "recruitee", url: "https://acme.recruitee.com/o/engineer/c/new", ats: "Recruitee", values: { name: "Alex Rivera", email: "alex.rivera@example.com", phone: "5551230000", q_1: "Yes" } },
  { name: "jazzhr", url: "https://app.jazz.co/apply/abc", ats: "JazzHR", values: { "resumator-firstname-value": "Alex", "resumator-address-value": "1 Market Street", "resumator-city-value": "Portland", "resumator-state-value": "CA", "resumator-postal-value": "94016" } },
  { name: "teamtailor", url: "https://acme.teamtailor.com/jobs/1/applications/new", ats: "Teamtailor", values: { candidate_first_name: "Alex", candidate_last_name: "Rivera", candidate_phone: "5551230000", candidate_linkedin: "https://linkedin.com/in/alexrivera" } },
  { name: "paylocity", url: "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1", ats: "Paylocity", byName: { "ctl00$FirstName": "Alex", "ctl00$Mobile": "5551230000", "ctl00$Zip": "94016" } },
];

for (const c of CASES) {
  test(`${c.name}: fields fill from the saved profile and nothing is filled wrongly`, async () => {
    const { report, doc, close } = await fill(site(c.name), c.url);
    try {
      assert.equal(report.ats, c.ats);
      for (const [id, want] of Object.entries(c.values || {})) assert.equal(doc.getElementById(id).value, want, id);
      for (const [name, want] of Object.entries(c.byName || {})) assert.equal(doc.querySelector(`[name="${name}"]`).value, want, name);
      for (const [name, want] of Object.entries(c.radios || {})) assert.equal(doc.querySelector(`input[name="${name}"]:checked`)?.value, want, name);
      for (const sel of c.unchecked || []) assert.equal(doc.querySelector(sel).checked, false, sel);
    } finally { close(); }
  });
}

test("text from a container shared with other fields never names a field", async () => {
  const { doc, close } = await fill('<form><div><label for="a">First name</label><input id="a"><input id="b" aria-label="Phone number"><input id="c" aria-label="LinkedIn"></div></form>', "https://example.test/");
  try {
    assert.equal(doc.getElementById("a").value, "Alex");
    assert.equal(doc.getElementById("b").value, "5551230000");
    assert.equal(doc.getElementById("c").value, "https://linkedin.com/in/alexrivera");
  } finally { close(); }
});

test("a checkbox whose label only mentions a profile keyword is not ticked by a text rule", async () => {
  const { doc, close } = await fill('<form><label><input type="checkbox" id="x"> Email me job alerts</label></form>', "https://example.test/");
  try { assert.equal(doc.getElementById("x").checked, false); } finally { close(); }
});

test("a radio question written beside its choices is read, not the neighbouring field's text", async () => {
  const { doc, close } = await fill('<form><div><span>First name</span><input id="n"></div><div><span>Are you legally authorized to work in this country?</span><label><input type="radio" name="w" value="y"> Yes</label><label><input type="radio" name="w" value="n"> No</label></div></form>', "https://example.test/");
  try { assert.equal(doc.querySelector('input[name="w"]:checked')?.value, "y"); } finally { close(); }
});
