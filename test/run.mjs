// jsdom fixture regression suite (#12).
//
// Loads each captured real-DOM Workday fixture into a jsdom window, evaluates the
// extension scripts against that window,
// then asserts matcher.signalFor + matcher.match mapping on a curated set of
// high-signal fields per page, plus unit cases for the native fillers.
//
// jsdom cannot reproduce Workday's React runtime. The suite covers matcher and
// native filler behavior plus fillPage orchestration against captured DOM. Live
// pages are still required to verify framework validation and custom dropdowns.
//
// Where a real Workday field does not map under current rules, the suite records
// that behavior explicitly. Calendar-popover-only dates remain tracked in #8.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("SmartRecruiters shadow fields are filled and notify the component host", async () => {
  const dom = new JSDOM('<oc-app-root><spl-input></spl-input><spl-phone-field></spl-phone-field></oc-app-root><div id="avid-autofill-root"></div>', {
    runScripts: "outside-only", pretendToBeVisual: true, url: "https://jobs.smartrecruiters.com/oneclick-ui/",
  });
  try {
    const win = dom.window;
    win.chrome = chromeShim();
    for (const src of SCRIPTS) win.eval(src);
    const host = win.document.querySelector("spl-input");
    host.attachShadow({ mode: "open" }).innerHTML = '<label for="field">First name</label><div><input id="field"></div>';
    const phone = win.document.querySelector("spl-phone-field");
    phone.attachShadow({ mode: "open" }).innerHTML = '<spl-input></spl-input>';
    phone.shadowRoot.querySelector("spl-input").attachShadow({ mode: "open" }).innerHTML = '<span id="label">Phone number</span><input aria-labelledby="label">';
    const inputs = [host.shadowRoot.querySelector("input"), phone.shadowRoot.querySelector("spl-input").shadowRoot.querySelector("input")];
    const ignored = win.document.getElementById("avid-autofill-root").attachShadow({ mode: "open" });
    ignored.innerHTML = '<input aria-label="First name">';
    for (const input of [...inputs, ignored.querySelector("input")]) input.getClientRects = () => [{}];
    let notified = false;
    host.addEventListener("input", () => { notified = true; });
    const A = win.AvidAutofill;
    const profile = structuredClone(A.DEFAULT_PROFILE);
    Object.assign(profile.personal, { firstName: "Test", phone: "2025550123" });
    const report = await A.engine.fillPage(profile, A.DEFAULT_SETTINGS, null);
    assert.equal(inputs[0].value, "Test", "visible shadow input must be filled");
    assert.equal(inputs[1].value, "2025550123", "nested shadow input must be filled");
    assert.equal(notified, true, "input event must cross the shadow boundary");
    assert.equal(ignored.querySelector("input").value, "");
    assert.equal(report.filledCount, 2);
    assert.equal(report.ats, "SmartRecruiters");
    profile.personal.email = "test@example.com";
    assert.equal(A.matcher.match("Confirm your email", profile, A.matcher.makeHelpers(profile)).value, profile.personal.email);
  } finally { dom.window.close(); }
});

// The fill logic, in manifest load order. Widget and main stay excluded because
// they mount UI and register Chrome listeners. engine.js is included so
// integration tests can exercise the public fillPage seam.
const SCRIPTS = [
  "src/shared/schema.js",
  "src/popup/target.js",
  "src/content/fillers.js",
  "src/content/matcher.js",
  "src/content/adapters.js",
  "src/content/workday.js",
  "src/content/engine.js",
].map((p) => fs.readFileSync(path.join(ROOT, p), "utf8"));

// Minimal in-memory chrome shim. schema.js references chrome.storage.local at
// definition time; the matcher/fillers/adapters themselves are pure DOM logic.
function chromeShim() {
  const store = {};
  return {
    storage: {
      local: {
        async get(key) {
          if (key == null) return { ...store };
          return { [key]: store[key] };
        },
        async set(obj) {
          Object.assign(store, obj);
        },
        async remove(key) {
          delete store[key];
        },
      },
    },
  };
}

// Simulate Workday's date-section spinbuttons under jsdom. On a live page these
// role="spinbutton" inputs commit typed digits to aria-valuenow (+ a display
// node), NOT to `.value`, and jsdom implements no execCommand. Override
// execCommand so setDateSpinner's insertText drives the spinbutton the way it
// does live — letting tests assert the real committed value (aria-valuenow)
// instead of the `.value` fiction. Returns false for anything that is not a
// focused spinbutton, so setTextValue's normal native-setter path is untouched.
function installDateSpinnerSim(win) {
  const doc = win.document;
  doc.execCommand = (cmd, _show, val) => {
    if (cmd !== "insertText") return false;
    const el = doc.activeElement;
    if (!el || el.getAttribute("role") !== "spinbutton") return false;
    const n = String(Number(val)); // "03" -> "3", "2021" -> "2021"
    el.setAttribute("aria-valuenow", n);
    el.setAttribute("aria-valuetext", n);
    return true;
  };
}

function loadFixture(name) {
  const html = fs.readFileSync(
    path.join(ROOT, "test/fixtures", name),
    "utf8"
  );
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.chrome = chromeShim();
  for (const src of SCRIPTS) win.eval(src);
  installDateSpinnerSim(win);
  return { dom, document: win.document, A: win.AvidAutofill };
}

// A jsdom window with the scripts loaded but no fixture, for native-filler units.
function blankWindow() {
  const dom = new JSDOM("<!doctype html><body></body>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.chrome = chromeShim();
  for (const src of SCRIPTS) dom.window.eval(src);
  installDateSpinnerSim(dom.window);
  return dom.window;
}

// Representative test profile (no real PII). DEFAULT_PROFILE merged with values.
function testProfile(A) {
  return A.mergeDefaults(A.DEFAULT_PROFILE, {
    personal: {
      firstName: "Alex",
      lastName: "Rivera",
      fullName: "Alex Rivera",
      preferredName: "Al",
      email: "alex.rivera@example.com",
      phone: "5551230000",
      address: "1 Market Street",
      city: "Portland",
      state: "CA",
      postalCode: "94016",
      country: "United States",
    },
    links: { linkedin: "https://linkedin.com/in/alexrivera" },
    work: [{ company: "Globex", title: "Software Engineer", endDate: "2023" }],
    education: [
      { school: "State University", degree: "BS", field: "Computer Science", gpa: "3.8", endDate: "2020" },
    ],
    workAuth: { authorizedToWork: "Yes", requireSponsorship: "No" },
    questions: { agreeToTerms: "Yes" },
  });
}

// Mirror the set of controls the engine's text/select/checkbox pass considers.
function fillableFields(document) {
  const skip = ["hidden", "submit", "button", "file", "password", "image", "reset"];
  return Array.from(document.querySelectorAll("input, textarea, select")).filter(
    (el) => !skip.includes((el.type || "").toLowerCase())
  );
}

// Find the first fillable control whose aggregated signal contains `needle`.
function fieldBySignal(document, A, needle) {
  const n = A.matcher.norm(needle);
  for (const el of fillableFields(document)) {
    if (A.matcher.signalFor(el).includes(n)) return el;
  }
  return null;
}

// Assert the mapping for the field identified by a signal substring.
// expected === null asserts "does not map".
function assertMapping(document, A, profile, needle, expected, msg) {
  const el = fieldBySignal(document, A, needle);
  assert.ok(el, `fixture field not found for signal "${needle}"`);
  const signal = A.matcher.signalFor(el);
  const m = A.matcher.match(signal, profile, A.matcher.makeHelpers(profile));
  if (expected === null) {
    assert.equal(m, null, msg || `expected no mapping for "${needle}" (signal: ${signal})`);
  } else {
    assert.ok(m, msg || `expected a mapping for "${needle}" (signal: ${signal})`);
    assert.equal(m.value, expected.value, `${msg || needle}: value`);
    if (expected.kind) assert.equal(m.kind, expected.kind, `${msg || needle}: kind`);
    // Copy alts into this realm: it is created in the jsdom window realm, so a
    // strict deepEqual would fail on the Array prototype mismatch alone.
    if (expected.alts) assert.deepEqual(Array.from(m.alts), expected.alts, `${msg || needle}: alts`);
  }
}

// --- Fixtures load & adapter detection -------------------------------------

test("all fixtures load and evaluate the extension scripts", () => {
  for (const n of ["page1", "page2", "page3", "page4", "page5"]) {
    const { A } = loadFixture(`workday-${n}.html`);
    assert.ok(A && A.matcher && A.fillers && A.adapters, `${n}: AvidAutofill wired`);
    assert.equal(typeof A.matcher.signalFor, "function");
    assert.equal(typeof A.matcher.match, "function");
  }
});

// --- Page 1: personal / contact / address ----------------------------------

test("page1: personal, contact and address fields map correctly", () => {
  const { document, A } = loadFixture("workday-page1.html");
  const p = testProfile(A);

  assertMapping(document, A, p, "first name", { value: "Alex" });
  assertMapping(document, A, p, "last name", { value: "Rivera" });
  assertMapping(document, A, p, "address line 1", { value: "1 Market Street" });
  assertMapping(document, A, p, "city* | city*", { value: "Portland" });
  assertMapping(document, A, p, "state*", { value: "CA", alts: ["California"] });
  assertMapping(document, A, p, "postal code", { value: "94016" });
  assertMapping(document, A, p, "email* | email*", { value: "alex.rivera@example.com" });
  assertMapping(document, A, p, "country / territory*", { value: "United States" });
  // The real phone-number field maps.
  assertMapping(document, A, p, "phone number* | phone number*", { value: "5551230000" });

  // "How did you hear about us" -> profile.misc.howHeard is blank here, so no fill.
  assertMapping(document, A, p, "how did you hear about us", null);

  // Workday's "Are you a previous worker?" Yes/No radio maps to the
  // previouslyEmployedHere preference (default "No") via the /previous worker/ rule.
  assertMapping(document, A, p, "candidate is previous worker", { value: "No", kind: "yesno" });

  // Workday's phone-type / extension fields contain "phone" but must NOT receive
  // the phone number — the phone rule excludes them so only the real phone-number
  // field (asserted above) maps.
  assertMapping(document, A, p, "phone device type", { value: "Mobile" });
  assertMapping(document, A, p, "phone extension", null);
  // The SMS opt-in field no longer grabs the phone number; it correctly maps to
  // the consent-to-contact yes/no preference via the /sms/ rule instead.
  assertMapping(document, A, p, "phone sms opt in", { value: "Yes", kind: "yesno" });
});

test("fillPage selects Mobile for Workday Phone Device Type", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div data-automation-id="formField-phoneDeviceType">
        <label>Phone Device Type</label>
        <button type="button" name="phoneDeviceType" aria-haspopup="listbox">Select One</button>
      </div>
    </div>
  `;

  const control = document.querySelector('button[name="phoneDeviceType"]');
  Object.defineProperty(control, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  control.addEventListener("click", () => {
    if (document.querySelector('[data-automation-id="promptOption"]')) return;
    const option = document.createElement("div");
    option.dataset.automationId = "promptOption";
    option.textContent = "Mobile";
    Object.defineProperty(option, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });
    option.addEventListener("click", () => {
      control.dataset.selected = option.textContent;
      option.remove();
    });
    document.body.append(option);
  });
  A.fillers.sleep = async () => {};

  await A.engine.fillPage(
    testProfile(A),
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  assert.equal(control.dataset.selected, "Mobile");
});

test("fillPage treats a rendered Workday phone input as visible when offsetParent is null", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div data-automation-id="formField-phoneNumber">
        <label for="phone">Phone Number</label><input id="phone" name="phoneNumber">
      </div>
    </div>
  `;
  const phone = document.getElementById("phone");
  Object.defineProperty(phone, "offsetParent", { configurable: true, value: null });
  phone.getClientRects = () => [{ width: 200, height: 32 }];
  A.fillers.sleep = async () => {};

  await A.engine.fillPage(
    testProfile(A),
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  assert.equal(phone.value, "5551230000");
});

// --- Page 2: work experience + links ---------------------------------------

test("page2: work experience and social links", () => {
  const { document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);

  assertMapping(document, A, p, "job title* | job title*", { value: "Software Engineer" });
  assertMapping(document, A, p, "please provide us your linkedin", {
    value: "https://linkedin.com/in/alexrivera",
  });

  // (#9) The generic matcher.match RULES table intentionally does NOT gain a
  // "company"/"location"/"description" rule here — a global regex for those
  // words would also fire on unrelated fields on other ATS's (e.g. a
  // Greenhouse "Preferred Location" field). Company/location/description/dates
  // are instead filled per-panel by workday.workExperiencePass (see below),
  // which resolves them directly from profile.work[N] scoped to panel N's own
  // container, bypassing the generic rules table entirely. So plain
  // matcher.match still returns no mapping for these signals in isolation —
  // that is by design, not a gap.
  assertMapping(document, A, p, "company* | company*", null);
  assertMapping(document, A, p, "role description", null);

  // Plain matcher.match (no panel scoping) still resolves "end date" via the
  // generic /end date/ -> education.endDate rule — workExperiencePass is what
  // prevents this from reaching the work-experience date fields in the real
  // fill flow (see the "datePass skips..." regression test below).
  assertMapping(document, A, p, "end date date section year", { value: "2020" });
});

// --- Page 2: work-experience repeater, panel-scoped (#9) --------------------

test("page2: workExperiencePass fills a panel scoped to its own container", async () => {
  const { dom, document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.work = [
    {
      title: "Staff Engineer",
      company: "Acme Corp",
      location: "Remote",
      description: "Led the platform team.",
      startDate: "2021-03",
      endDate: "2023-06",
      current: false,
    },
  ];

  const handled = new dom.window.WeakSet();
  const records = [];
  await A.workday.workExperiencePass(p, {
    fillers: A.fillers,
    record: (label, value, status) => records.push({ label, value, status }),
    handled,
  });

  const panel = document.querySelector('[aria-labelledby="Work-Experience-1-panel"]');
  assert.ok(panel, "fixture has a Work Experience 1 panel");
  assert.equal(panel.querySelector('[data-automation-id="formField-jobTitle"] input').value, "Staff Engineer");
  assert.equal(panel.querySelector('[data-automation-id="formField-companyName"] input').value, "Acme Corp");
  assert.equal(panel.querySelector('[data-automation-id="formField-location"] input').value, "Remote");
  assert.equal(
    panel.querySelector('[data-automation-id="formField-roleDescription"] textarea').value,
    "Led the platform team."
  );

  const startMonth = panel.querySelector(
    '[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionMonth-input"]'
  );
  const startYear = panel.querySelector(
    '[data-automation-id="formField-startDate"] input[data-automation-id="dateSectionYear-input"]'
  );
  // Date sections are role="spinbutton": the committed value lives in
  // aria-valuenow (Workday stores it un-padded), not `.value` (always empty).
  assert.equal(startMonth.getAttribute("aria-valuenow"), "3");
  assert.equal(startYear.getAttribute("aria-valuenow"), "2021");

  const endMonth = panel.querySelector(
    '[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionMonth-input"]'
  );
  assert.equal(endMonth.getAttribute("aria-valuenow"), "6");

  // Every field workExperiencePass touched is marked handled so the generic
  // engine passes skip it (no double-fill / no collision).
  const jobTitleEl = panel.querySelector('[data-automation-id="formField-jobTitle"] input');
  assert.ok(handled.has(jobTitleEl));
});

test("page2: a currently-employed panel checks the box and leaves end date blank", async () => {
  const { dom, document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.work = [
    { title: "Engineer", company: "Acme", startDate: "2022-01", endDate: "2099-12", current: true },
  ];

  const handled = new dom.window.WeakSet();
  await A.workday.workExperiencePass(p, { fillers: A.fillers, record: () => {}, handled });

  const panel = document.querySelector('[aria-labelledby="Work-Experience-1-panel"]');
  const box = panel.querySelector('[data-automation-id="formField-currentlyWorkHere"] input');
  assert.equal(box.checked, true);
  const endYear = panel.querySelector(
    '[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionYear-input"]'
  );
  // current === true means workExperiencePass must NOT touch the end date: the
  // section keeps the fixture's captured value ("2020") and is never overwritten
  // with the profile's end year ("2099").
  assert.equal(endYear.getAttribute("aria-valuenow"), "2020", "end date is not filled when currently employed");
});

test("fillPage adds and fills the first Workday education panel", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div role="group" aria-labelledby="Education-section">
        <h4 id="Education-section">Education</h4>
        <button type="button" data-automation-id="add-button">Add</button>
      </div>
    </div>
  `;

  const section = document.querySelector('[aria-labelledby="Education-section"]');
  const addButton = section.querySelector('button[data-automation-id="add-button"]');
  addButton.addEventListener("click", () => {
    if (section.querySelector('[aria-labelledby="Education-1-panel"]')) return;
    const panel = document.createElement("div");
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-labelledby", "Education-1-panel");
    panel.innerHTML = `
      <h5 id="Education-1-panel">Education 1</h5>
      <div data-automation-id="formField-school"><label>School or University</label><input data-uxi-widget-type="selectinput"></div>
      <div data-automation-id="formField-degree"><label>Degree</label><button type="button" name="degree" aria-haspopup="listbox">Select One</button></div>
      <div data-automation-id="formField-fieldOfStudy"><label>Field of Study</label><input data-uxi-widget-type="selectinput"></div>
      <div data-automation-id="formField-gradeAverage"><label>Overall Result (GPA)</label><input name="gradeAverage"></div>
      <div data-automation-id="formField-firstYearAttended"><label>From</label><input role="spinbutton" data-automation-id="dateSectionYear-input"></div>
      <div data-automation-id="formField-lastYearAttended"><label>To (Actual or Expected)</label><input role="spinbutton" data-automation-id="dateSectionYear-input"></div>
    `;
    section.insertBefore(panel, addButton);

    const pickerOptions = new Map([
      [panel.querySelector('[data-automation-id="formField-school"] input'), "UCSD"],
      [panel.querySelector('[data-automation-id="formField-degree"] button'), "Bachelor's Degree or Equivalent"],
      [panel.querySelector('[data-automation-id="formField-fieldOfStudy"] input'), "Data Science"],
    ]);
    for (const [control, text] of pickerOptions) {
      control.addEventListener("click", () => {
        document.querySelectorAll('[data-automation-id="promptOption"]').forEach((node) => node.remove());
        const option = document.createElement("div");
        option.dataset.automationId = "promptOption";
        option.textContent = text;
        Object.defineProperty(option, "offsetParent", {
          configurable: true,
          get: () => document.body,
        });
        option.addEventListener("click", () => {
          control.dataset.selected = text;
          option.remove();
        });
        document.body.append(option);
      });
    }
  });
  A.fillers.sleep = async () => {};

  const p = testProfile(A);
  p.education = [{
    school: "UCSD",
    degree: "Bachelor of Science",
    field: "Data Science",
    gpa: "3.91",
    startDate: "Sep 2023",
    endDate: "Mar 2027",
  }];

  await A.engine.fillPage(
    p,
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  const panel = section.querySelector('[aria-labelledby="Education-1-panel"]');
  assert.ok(panel, "education panel was added");
  assert.equal(panel.querySelector('[data-automation-id="formField-school"] input').dataset.selected, "UCSD");
  assert.equal(
    panel.querySelector('[data-automation-id="formField-degree"] button').dataset.selected,
    "Bachelor's Degree or Equivalent"
  );
  assert.equal(panel.querySelector('[data-automation-id="formField-fieldOfStudy"] input').dataset.selected, "Data Science");
  assert.equal(panel.querySelector('[data-automation-id="formField-gradeAverage"] input').value, "3.91");
  assert.equal(
    panel.querySelector('[data-automation-id="formField-firstYearAttended"] input').getAttribute("aria-valuenow"),
    "2023"
  );
  assert.equal(
    panel.querySelector('[data-automation-id="formField-lastYearAttended"] input').getAttribute("aria-valuenow"),
    "2027"
  );
});

test("fillPage adds saved skills through Workday's skills picker", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div role="group" aria-labelledby="Skills-section">
        <h4 id="Skills-section">Skills</h4>
        <div data-automation-id="formField-skills">
          <label>Type to Add Skills</label>
          <input data-uxi-widget-type="selectinput" placeholder="Search">
        </div>
      </div>
    </div>
  `;

  const input = document.querySelector('[data-automation-id="formField-skills"] input');
  const selected = [];
  input.addEventListener("click", () => {
    document.querySelectorAll('[data-automation-id="promptOption"]').forEach((node) => node.remove());
    const option = document.createElement("div");
    option.dataset.automationId = "promptOption";
    option.textContent = input.value || "Python";
    Object.defineProperty(option, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });
    option.addEventListener("click", () => {
      selected.push(option.textContent);
      option.remove();
    });
    document.body.append(option);
  });
  input.addEventListener("input", () => {
    const option = document.querySelector('[data-automation-id="promptOption"]');
    if (option) option.textContent = input.value;
  });
  A.fillers.sleep = async () => {};

  const p = testProfile(A);
  p.misc.skills = "Python, SQL";
  await A.engine.fillPage(
    p,
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  assert.deepEqual(selected.map((value) => value.toLowerCase()), ["python", "sql"]);
});

test("page2: datePass skips date sections workExperiencePass already filled", async () => {
  const { dom, document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.work = [{ title: "Engineer", company: "Acme", startDate: "2021-03", endDate: "2022-05" }];
  p.education = [{ school: "State University", endDate: "2020" }];

  const handled = new dom.window.WeakSet();
  const helpers = A.matcher.makeHelpers(p);
  const record = () => {};

  await A.workday.workExperiencePass(p, { fillers: A.fillers, record, handled });
  await A.workday.datePass(p, { matcher: A.matcher, helpers, fillers: A.fillers, record, handled });

  const panel = document.querySelector('[aria-labelledby="Work-Experience-1-panel"]');
  const endYear = panel.querySelector(
    '[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionYear-input"]'
  );
  // Without the handled-skip in datePass, its generic /end date/ rule would
  // overwrite this with profile.education[0].endDate ("2020") — see the
  // "plain matcher.match" assertion above documenting that rule in isolation.
  assert.equal(endYear.getAttribute("aria-valuenow"), "2022", "work end date is not clobbered by the generic end-date rule");
});

test("fillPage leaves a current role's blank end date untouched", async () => {
  const { document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.work = [{ title: "Engineer", company: "Acme", startDate: "2022-01", current: true }];
  p.education = [{ school: "State University", endDate: "2077-06" }];

  const panel = document.querySelector('[aria-labelledby="Work-Experience-1-panel"]');
  const endMonth = panel.querySelector(
    '[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionMonth-input"]'
  );
  const endYear = panel.querySelector(
    '[data-automation-id="formField-endDate"] input[data-automation-id="dateSectionYear-input"]'
  );
  for (const el of [endMonth, endYear]) {
    el.removeAttribute("aria-valuenow");
    el.removeAttribute("aria-valuetext");
  }

  await A.engine.fillPage(p, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);

  assert.equal(endMonth.getAttribute("aria-valuenow"), null);
  assert.equal(endYear.getAttribute("aria-valuenow"), null);
});

test("fillPage does not double-blur the final Workday date spinner", async () => {
  const { document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.work = [{ title: "Engineer", company: "Acme", startDate: "2024-06", current: true }];

  const year = document.querySelector(
    '[aria-labelledby="Work-Experience-1-panel"] ' +
      '[data-automation-id="formField-startDate"] ' +
      'input[data-automation-id="dateSectionYear-input"]'
  );
  let blurCount = 0;
  year.addEventListener("blur", () => blurCount++);

  await A.engine.fillPage(p, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);

  assert.equal(blurCount, 1);
});

test("fillPage reports a Workday date error when the spinner rejects input", async () => {
  const { dom, document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.work = [{ title: "Engineer", company: "Acme", startDate: "2024-06", current: true }];
  document.execCommand = () => false;

  const startDate = document.querySelector(
    '[aria-labelledby="Work-Experience-1-panel"] [data-automation-id="formField-startDate"]'
  );
  for (const el of startDate.querySelectorAll('input[role="spinbutton"]')) {
    el.removeAttribute("aria-valuenow");
    el.removeAttribute("aria-valuetext");
  }

  const report = await A.engine.fillPage(
    p,
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  const result = report.results.find((r) => r.label === "Work 1 - Start Date");
  assert.equal(result.status, "error");
  assert.equal(
    startDate.querySelector('input[data-automation-id="dateSectionYear-input"]').getAttribute(
      "aria-valuenow"
    ),
    null
  );
  dom.window.close();
});

test("fillPage refuses untouched Workday pages that cannot commit synthetic input", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <label for="first">First Name</label><input id="first">
    </div>
  `;
  Object.defineProperty(win.navigator, "userActivation", {
    configurable: true,
    value: { hasBeenActive: false },
  });

  const report = await A.engine.fillPage(
    testProfile(A),
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  assert.equal(report.blocked, "workday-needs-page-click");
  assert.equal(report.filledCount, 0);
  assert.equal(document.getElementById("first").value, "");
});

test("page2: extra work entries beyond available panels do not throw (click-to-add is live-only)", async () => {
  const { dom, document, A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.work = [
    { title: "Engineer II", company: "Acme" },
    { title: "Engineer I", company: "Beta" },
  ];

  const handled = new dom.window.WeakSet();
  // jsdom has no React runtime, so clicking "Add Another" is a no-op and no
  // second panel ever appears — this exercises the guard/give-up path, not the
  // real click-to-grow flow (that needs a live Workday page, see comment on
  // workExperiencePass in src/content/workday.js).
  await assert.doesNotReject(() =>
    A.workday.workExperiencePass(p, { fillers: A.fillers, record: () => {}, handled })
  );
  const panel = document.querySelector('[aria-labelledby="Work-Experience-1-panel"]');
  assert.equal(panel.querySelector('[data-automation-id="formField-jobTitle"] input').value, "Engineer II");
});

test("work-panel job-title fields are owned by the repeater, not the generic matcher (title-bleed guard)", () => {
  const win = blankWindow();
  const A = win.AvidAutofill;
  // Two work panels, each with its own "Job Title" input, plus a standalone
  // current-title field (Greenhouse/Lever style) outside any panel.
  win.document.body.innerHTML = `
    <div role="group" aria-labelledby="Work-Experience-section">
      <div role="group" aria-labelledby="Work-Experience-1-panel">
        <div data-automation-id="formField-jobTitle"><label>Job Title</label><input name="jobTitle"></div>
      </div>
      <div role="group" aria-labelledby="Work-Experience-2-panel">
        <div data-automation-id="formField-jobTitle"><label>Job Title</label><input name="jobTitle"></div>
      </div>
    </div>
    <div data-automation-id="formField-currentTitle"><label>Current Title</label><input></div>
  `;
  const p = testProfile(A);
  const helpers = A.matcher.makeHelpers(p);

  const panelTitles = [
    ...win.document.querySelectorAll(
      '[aria-labelledby$="-panel"] [data-automation-id="formField-jobTitle"] input'
    ),
  ];
  assert.equal(panelTitles.length, 2);

  for (const inp of panelTitles) {
    // The generic matcher WOULD map every panel title to work[0].title — that is
    // the title-bleed bug. isWorkExperienceField is what makes the engine's
    // generic passes skip these, leaving each panel to workExperiencePass.
    assert.equal(
      A.matcher.match(A.matcher.signalFor(inp), p, helpers).value,
      "Software Engineer"
    );
    assert.ok(
      A.workday.isWorkExperienceField(inp),
      "panel title is a work-experience field the engine skips"
    );
  }

  // A standalone current-title field is not in a panel, so the generic rule still
  // fills it with the primary job title (unchanged behavior off Workday panels).
  const standalone = win.document.querySelector(
    '[data-automation-id="formField-currentTitle"] input'
  );
  assert.ok(!A.workday.isWorkExperienceField(standalone));
  assert.equal(
    A.matcher.match(A.matcher.signalFor(standalone), p, helpers).value,
    "Software Engineer"
  );
});

test("fillPage preserves distinct Workday titles after panel inputs rerender", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage"></div>
    <div role="group" aria-labelledby="Work-Experience-section">
      <div role="group" aria-labelledby="Work-Experience-1-panel">
        <div data-automation-id="formField-jobTitle"><label>Job Title</label><input name="jobTitle"></div>
      </div>
      <div role="group" aria-labelledby="Work-Experience-2-panel">
        <div data-automation-id="formField-jobTitle"><label>Job Title</label><input name="jobTitle"></div>
      </div>
    </div>
  `;

  for (const input of document.querySelectorAll('input[name="jobTitle"]')) {
    input.addEventListener(
      "input",
      () => {
        const replacement = input.cloneNode();
        replacement.value = input.value;
        Object.defineProperty(replacement, "offsetParent", {
          configurable: true,
          get: () => document.body,
        });
        input.replaceWith(replacement);
      },
      { once: true }
    );
  }

  const p = testProfile(A);
  p.work = [
    { title: "Staff Engineer", company: "Acme" },
    { title: "Senior Engineer", company: "Beta" },
  ];

  await A.engine.fillPage(
    p,
    { overwriteFilled: true, fillEEO: false, highlightFilled: false },
    null
  );

  assert.deepEqual(
    Array.from(document.querySelectorAll('input[name="jobTitle"]'), (input) => input.value),
    ["Staff Engineer", "Senior Engineer"]
  );
});

test("fillPage does not apply Workday panel ownership to a generic form", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <form>
      <div role="group" aria-labelledby="Work-Experience-1-panel">
        <label for="first">First Name</label><input id="first">
      </div>
    </form>
  `;
  const first = document.getElementById("first");
  Object.defineProperty(first, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });

  const report = await A.engine.fillPage(
    testProfile(A),
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  assert.equal(report.ats, "Generic");
  assert.equal(first.value, "Alex");
});

test("setDateSpinner commits to aria-valuenow (spinbutton), never to .value, and does not blur", () => {
  const win = blankWindow();
  const A = win.AvidAutofill;
  win.document.body.innerHTML =
    '<input role="spinbutton" aria-valuetext="MM" aria-valuemin="1" aria-valuemax="12">';
  const el = win.document.querySelector("input");
  let blurs = 0;
  el.addEventListener("blur", () => blurs++);

  A.fillers.setDateSpinner(el, "06");

  assert.equal(el.getAttribute("aria-valuenow"), "6", "value commits to aria-valuenow");
  assert.equal(el.value, "", "never assigns .value, which a spinbutton's handler ignores");
  assert.equal(blurs, 0, "blur is the caller's job so a half-filled date is never validated");
});

// --- Page 3: work authorization (yes/no) -----------------------------------

test("page3: work authorization questions map to yes/no", () => {
  const { document, A } = loadFixture("workday-page3.html");
  const p = testProfile(A);

  assertMapping(document, A, p, "legally authorized to work in the united states", {
    value: "Yes",
    kind: "yesno",
  });
  assertMapping(document, A, p, "require sponsorship from philips", {
    value: "No",
    kind: "yesno",
  });

  // The temporary-authorization (OPT/CPT) question contains "work authorization"
  // but is a distinct question that must not be auto-answered "Yes" — the
  // authorizedToWork rule excludes temporary/OPT/CPT phrasing, so it does not map.
  assertMapping(document, A, p, "temporary authorization", null);
});

// --- Page 4: EEO + terms ----------------------------------------------------

test("page4: EEO fields and terms consent", () => {
  const { document, A } = loadFixture("workday-page4.html");
  const p = testProfile(A);

  // Terms-and-conditions consent checkbox maps to agreeToTerms (yes/no).
  assertMapping(document, A, p, "consent to the terms and conditions", {
    value: "Yes",
    kind: "yesno",
  });

  // Workday labels its gender question "Please select your sex"; the eeo gender
  // rule matches /\bsex\b/. (EEO fields only fill when settings.fillEEO is on;
  // the matcher maps regardless and the engine gates whether it is applied.)
  p.eeo.gender = "Female";
  assertMapping(document, A, p, "please select your sex", { value: "Female" });

  // "ethniCITY" contains the substring "city"; the /city/ rule now uses a word
  // boundary (/\bcity\b/) so the race/ethnicity question no longer grabs the
  // profile city. With EEO fill off it does not map at all.
  assertMapping(document, A, p, "ethnicity or race", null);
});

// --- Page 5: self-identify disability ---------------------------------------

test("page5: disability self-ID form", () => {
  const { document, A } = loadFixture("workday-page5.html");
  const p = testProfile(A);

  // A standalone "Name" field (here on the disability self-ID form, signal
  // "name* | name* | name | ...") maps to the full name: the full-name rule
  // matches a standalone "name" token, not only an exact /^name$/ signal.
  assertMapping(document, A, p, "self identified disability data name", { value: "Alex Rivera" });

  // Employee ID has no rule (expected: no mapping).
  assertMapping(document, A, p, "employee id", null);
});

// --- Native fillers (constructed elements, no fixture) ----------------------

test("setNativeSelect picks the matching <option> by text and by value", () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;

  const sel = document.createElement("select");
  sel.innerHTML =
    '<option value="">Select…</option>' +
    '<option value="US">United States</option>' +
    '<option value="CA">Canada</option>';
  document.body.appendChild(sel);

  // Match by option text.
  assert.equal(A.fillers.setNativeSelect(sel, "United States"), true);
  assert.equal(sel.value, "US");

  // Match by option value.
  assert.equal(A.fillers.setNativeSelect(sel, "CA"), true);
  assert.equal(sel.value, "CA");

  // No matching option -> false, value unchanged.
  const before = sel.value;
  assert.equal(A.fillers.setNativeSelect(sel, "Nowhere"), false);
  assert.equal(sel.value, before);
});

test("setRadio selects the radio in a group whose label/value matches", () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;

  const wrap = document.createElement("div");
  wrap.innerHTML =
    '<label><input type="radio" name="auth" value="Yes">Yes</label>' +
    '<label><input type="radio" name="auth" value="No">No</label>';
  document.body.appendChild(wrap);
  const inputs = Array.from(wrap.querySelectorAll('input[type="radio"]'));

  assert.equal(A.fillers.setRadio(inputs, "Yes"), true);
  assert.equal(inputs[0].checked, true);
  assert.equal(inputs[1].checked, false);

  assert.equal(A.fillers.setRadio(inputs, "No"), true);
  assert.equal(inputs[1].checked, true);

  // Unmatched value -> false.
  assert.equal(A.fillers.setRadio(inputs, "Maybe"), false);
});

test("setCheckbox toggles a checkbox to the requested state", () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;

  const box = document.createElement("input");
  box.type = "checkbox";
  document.body.appendChild(box);

  assert.equal(box.checked, false);
  A.fillers.setCheckbox(box, true);
  assert.equal(box.checked, true);

  // Requesting the state it already has leaves it unchanged.
  A.fillers.setCheckbox(box, true);
  assert.equal(box.checked, true);

  A.fillers.setCheckbox(box, false);
  assert.equal(box.checked, false);
});

test("setTextValue sets an input's value (native-setter fallback under jsdom)", () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;

  const input = document.createElement("input");
  input.type = "text";
  document.body.appendChild(input);

  A.fillers.setTextValue(input, "hello world");
  assert.equal(input.value, "hello world");

  const area = document.createElement("textarea");
  document.body.appendChild(area);
  A.fillers.setTextValue(area, "multi\nline");
  assert.equal(area.value, "multi\nline");
});

test("setReactSelect never chooses an unrelated first option", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <input data-uxi-widget-type="selectinput">
    <div data-automation-id="promptOption">Aarhus University</div>
  `;
  const control = document.querySelector("input");
  const option = document.querySelector('[data-automation-id="promptOption"]');
  let clicked = false;
  option.addEventListener("click", () => { clicked = true; });
  Object.defineProperty(option, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });

  const ok = await A.fillers.setReactSelect(control, [
    "University of California, San Diego",
    "UCSD",
  ]);

  assert.equal(ok, false);
  assert.equal(clicked, false);
});

test("setReactSelect keeps a typeahead focused until its matching option is chosen", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <input data-uxi-widget-type="selectinput">
    <div data-automation-id="promptOption">University of California, San Diego</div>
  `;
  const control = document.querySelector("input");
  const option = document.querySelector('[data-automation-id="promptOption"]');
  let clicked = false;
  option.addEventListener("click", () => { clicked = true; });
  control.addEventListener("blur", () => { option.remove(); });
  Object.defineProperty(option, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });

  const ok = await A.fillers.setReactSelect(control, ["University of California, San Diego"]);

  assert.equal(ok, true);
  assert.equal(clicked, true);
});

test("setReactSelect can commit a Workday typeahead with Enter when allowed", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = '<input data-uxi-widget-type="selectinput">';
  const control = document.querySelector("input");
  control.addEventListener("keydown", (event) => {
    if (event.key === "Enter") control.dataset.selected = control.value;
  });

  const ok = await A.fillers.setReactSelect(control, ["Data Science"], {
    allowCreate: true,
  });

  assert.equal(ok, true);
  assert.equal(control.dataset.selected, "data science");
});

// --- Adapter detection ------------------------------------------------------

test("adapters.detect resolves an adapter without throwing", () => {
  const { A } = loadFixture("workday-page1.html");
  const adapter = A.adapters.detect();
  assert.ok(adapter && typeof adapter.name === "string");
});

test("popup chooses the recognized frame that contains the application fields", () => {
  const win = blankWindow();
  const selected = win.AvidAutofill.popup.selectTarget([
    { frameId: 0, result: { ats: "Workday", beta: true, fields: 0 } },
    { frameId: 7, result: { ats: "Workday", beta: true, fields: 12 } },
  ]);

  assert.equal(selected.frameId, 7);
  assert.equal(selected.fields, 12);
});
