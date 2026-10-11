// Fill checks against saved-form layouts from other hiring sites (iCIMS, Taleo,
// Jobvite, BambooHR, Breezy, Recruitee, JazzHR, Teamtailor, Paylocity). These
// are hand-built to match each site's markup, not captures, so they pin down
// the layout patterns (table rows, label-less placeholders, question spans)
// rather than any one company's form.
import { test } from "vitest";
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

const withProfile = async (html, url, edit) => {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url });
  const win = dom.window, store = {};
  win.chrome = { storage: { local: { async get(k) { return k == null ? { ...store } : { [k]: store[k] }; }, async set(o) { Object.assign(store, o); }, async remove(k) { delete store[k]; } } } };
  for (const src of SCRIPTS) win.eval(src);
  win.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }];
  const A = win.AvidAutofill;
  A.fillers.sleep = async () => {};
  const profile = A.mergeDefaults(A.DEFAULT_PROFILE, { personal: { state: "CA", country: "United States" }, education: [{ school: "University of California, Berkeley", degree: "BS", field: "Computer Science" }], work: [{ company: "Globex", title: "Software Engineer" }], misc: { salaryExpectation: "$150,000 - $180,000 USD", languages: "English, Spanish" }, eeo: { veteranStatus: "No", disabilityStatus: "Decline to self-identify" } });
  if (edit) edit(profile);
  const report = await A.engine.fillPage(profile, { ...A.DEFAULT_SETTINGS, fillEEO: true }, null);
  return { report, doc: win.document, close: () => win.close() };
};

test("expected annual package is answered with the saved pay range", async () => {
  const { doc, close } = await withProfile('<form><label for="p">Expected annual package (please indicate currency)</label><input id="p"></form>', "https://example.test/");
  try { assert.equal(doc.getElementById("p").value, "$150,000 - $180,000 USD"); } finally { close(); }
});

test("a how-many-years or relocation package question is not read as pay", async () => {
  const { doc, close } = await withProfile('<form><label for="p">Do you need a relocation package?</label><input id="p"></form>', "https://example.test/");
  try { assert.equal(doc.getElementById("p").value, ""); } finally { close(); }
});

test("resident-of-state, AI note-taker consent and language lists", async () => {
  const { doc, close } = await withProfile(`<form>
    <div><div class="q">Are you a resident of California?</div><label><input type="radio" name="r" value="Yes"> Yes</label><label><input type="radio" name="r" value="No"> No</label></div>
    <div><div class="q">Are you a resident of New York?</div><label><input type="radio" name="s" value="Yes"> Yes</label><label><input type="radio" name="s" value="No"> No</label></div>
    <div><div class="q">We may use AI notetakers to transcribe conversations. Do you consent?</div><label><input type="radio" name="n" value="Yes, I consent"> Yes, I consent</label><label><input type="radio" name="n" value="No, I do not consent"> No, I do not consent</label></div>
    <div><div class="q">Language Skill(s) (Check all that apply)</div><ul><li><label><input type="checkbox" name="l" value="English (ENG)"> English (ENG)</label></li><li><label><input type="checkbox" name="l" value="Spanish (SPA)"> Spanish (SPA)</label></li><li><label><input type="checkbox" name="l" value="French (FRA)"> French (FRA)</label></li></ul></div>
  </form>`, "https://jobs.lever.co/x/1/apply");
  try {
    const checked = (n) => [...doc.querySelectorAll(`input[name="${n}"]:checked`)].map((e) => e.value);
    assert.deepEqual(checked("r"), ["Yes"]);
    assert.deepEqual(checked("s"), ["No"]);
    assert.deepEqual(checked("n"), ["Yes, I consent"]);
    assert.deepEqual(checked("l"), ["English (ENG)", "Spanish (SPA)"]);
  } finally { close(); }
});

test("which-university dropdowns, veteran and disability sentences, and punctuation differences in options", async () => {
  const { doc, close } = await withProfile(`<form>
    <label for="u">Which university are you currently attending or did you last attend?</label><select id="u"><option value="">Select</option><option>University of California - Davis</option><option>University of California - Berkeley</option></select>
    <label for="v">Veteran status</label><select id="v"><option value="">Select ...</option><option value="a">I identify as one or more of the classifications of protected veteran listed above</option><option value="b">I am not a protected veteran</option><option value="c">I decline to self-identify for protected veteran status</option></select>
    <label for="d">Disability status</label><select id="d"><option value="">Select ...</option><option value="y">Yes, I have a disability, or have had one in the past</option><option value="n">No, I do not have a disability and have not had one in the past</option><option value="x">I do not want to answer</option></select>
  </form>`, "https://example.test/");
  try {
    assert.equal(doc.getElementById("u").value, "University of California - Berkeley");
    assert.equal(doc.getElementById("v").value, "b");
    assert.equal(doc.getElementById("d").value, "x");
  } finally { close(); }
});

test("a yes/no rule never writes into a free-text question", async () => {
  const { doc, close } = await withProfile('<form><label for="t">Have you worked with distributed systems? Briefly explain.</label><textarea id="t"></textarea></form>', "https://example.test/");
  try { assert.equal(doc.getElementById("t").value, ""); } finally { close(); }
});

test("Breezy work and education rows take their own profile entries, with dates", async () => {
  const row = (model, fields) => `<li class="experience">${fields.map((f) => `<input ng-model="${model}.${f}" ${f.startsWith("date") ? 'type="date"' : 'type="text"'} placeholder="Company">`).join("")}</li>`;
  const html = `<form><ul>${row("candidatePosition", ["company_name", "title", "date_start", "date_end"]).repeat(3)}</ul><ul>${row("candidateSchool", ["school_name", "field_of_study", "date_start", "date_end"])}</ul></form>`;
  const { doc, close } = await withProfile(html, "https://acme.breezy.hr/p/abc", (p) => {
    p.work = [{ company: "Globex", title: "Engineer", startDate: "Jun 2021", endDate: "Present", current: true }, { company: "Initech", title: "Intern", startDate: "2019", endDate: "Aug 2020" }];
    p.education = [{ school: "University of California, San Diego", field: "Computer Science", startDate: "Sep 2016", endDate: "2020" }];
  });
  try {
    const at = (model, field, i) => doc.querySelectorAll(`[ng-model="${model}.${field}"]`)[i].value;
    assert.deepEqual([0, 1, 2].map((i) => at("candidatePosition", "company_name", i)), ["Globex", "Initech", ""]);
    assert.equal(at("candidatePosition", "date_start", 0), "2021-06-01");
    assert.equal(at("candidatePosition", "date_end", 0), "", "a current role has no end date");
    assert.equal(at("candidatePosition", "date_start", 1), "2019-01-01");
    assert.equal(at("candidatePosition", "date_end", 1), "2020-08-01");
    assert.equal(at("candidateSchool", "school_name", 0), "University of California, San Diego");
    assert.equal(at("candidateSchool", "date_end", 0), "2020-12-01");
  } finally { close(); }
});

test("Lever self-ID and screening: signature date, race, sponsorship wording, home address, Yes/No checkboxes, follow-up questions", async () => {
  const { doc, close } = await withProfile(`<form>
    <div><label for="addr">Primary Residence Address</label><input id="addr"></div>
    <div><label for="sp">Will you now or in the future require ACME to sponsor you for employment authorization?</label><input id="sp"></div>
    <div><label for="where">If so, where would you be open to relocating?</label><input id="where"></div>
    <div><div>Are you currently legally authorized to work in the United States? (Y/N)</div><ul><li><label><input type="checkbox" name="auth" value="Yes"><span>Yes</span></label></li><li><label><input type="checkbox" name="auth" value="No"><span>No</span></label></li></ul></div>
    <label>Race<select id="race"><option value="">Select ...</option><option>Hispanic or Latino</option><option>White (Not Hispanic or Latino)</option><option>Asian (Not Hispanic or Latino)</option></select></label>
    <label>Disability status<select id="dis"><option value="">Select</option><option>Yes, I have a disability</option><option>No, I do not have a disability</option></select></label>
    <input id="sigdate" placeholder="mm/dd/yyyy" name="eeo[disabilitySignatureDate]" aria-label="Date">
  </form>`, "https://jobs.lever.co/x/1/apply", (p) => { p.personal.address = "1 Market St"; p.personal.city = "San Diego"; p.eeo.race = "Asian"; p.misc.willingToRelocate = "Yes"; });
  try {
    assert.equal(doc.getElementById("addr").value, "1 Market St, San Diego, CA, United States");
    assert.equal(doc.getElementById("sp").value, "No");
    assert.equal(doc.getElementById("where").value, "", "a where-question is not answered Yes");
    assert.deepEqual([...doc.querySelectorAll('input[name="auth"]:checked')].map((c) => c.value), ["Yes"]);
    assert.equal(doc.getElementById("race").value, "Asian (Not Hispanic or Latino)");
    assert.match(doc.getElementById("sigdate").value, /^\d\d\/\d\d\/\d{4}$/);
    assert.notEqual(doc.getElementById("sigdate").value, "No");
  } finally { close(); }
});
