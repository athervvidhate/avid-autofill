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
  "src/shared/skills.js",
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

function loadFixture(name, url = "https://example.test/") {
  const html = fs.readFileSync(
    path.join(ROOT, "test/fixtures", name),
    "utf8"
  );
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url,
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

test("fillPage answers Workday relatives and PwC screening questions as assumed No", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  const questions = [
    "Do you have any relatives or others with close personal relationships employed by Bank of America or any of its subsidiaries or affiliates?",
    "Do you currently or have you worked at PricewaterhouseCoopers LLP (PwC), the bank's independent auditor, since July 2002?",
  ];
  document.body.innerHTML = `<div data-automation-id="applyFlowPage">${questions.map((q, i) =>
    `<fieldset><legend>${q}</legend><button type="button" name="q${i}" aria-haspopup="listbox">Select One</button></fieldset>`).join("")}</div>`;
  const visible = (el) => Object.defineProperty(el, "offsetParent", { configurable: true, get: () => document.body });
  for (const control of document.querySelectorAll("button")) {
    visible(control);
    control.addEventListener("click", () => {
      if (document.querySelector('[data-automation-id="promptOption"]')) return;
      for (const text of ["Yes", "No"]) {
        const option = document.createElement("div");
        option.dataset.automationId = "promptOption";
        option.textContent = text;
        visible(option);
        option.addEventListener("click", () => { control.dataset.selected = text; document.querySelectorAll('[data-automation-id="promptOption"]').forEach((o) => o.remove()); });
        document.body.append(option);
      }
    });
  }
  A.fillers.sleep = async () => {};
  const report = await A.engine.fillPage(testProfile(A), { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);
  assert.deepEqual([...document.querySelectorAll("button")].map((b) => b.dataset.selected), ["No", "No"]);
  assert.equal(report.results.filter((r) => r.status === "assumed").length, 2);
});

test("Jev reads Workday button-dropdown options and lists unreadable ones as needing an answer", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `<fieldset><legend>Were you referred by an employee?</legend><button type="button" aria-haspopup="listbox">Select One</button></fieldset>`;
  const button = document.querySelector("button");
  Object.defineProperty(button, "offsetParent", { configurable: true, get: () => document.body });
  A.fillers.sleep = async () => {};
  assert.deepEqual([...await A.fillers.customOptions(button)], []);
  button.addEventListener("click", () => {
    if (document.querySelector('[role="listbox"]')) return;
    const box = document.createElement("ul");
    box.setAttribute("role", "listbox");
    Object.defineProperty(box, "offsetParent", { configurable: true, get: () => document.body });
    box.innerHTML = '<li role="option">Yes</li><li role="option">No</li>';
    document.body.append(box);
  });
  assert.deepEqual([...await A.fillers.customOptions(button)], ["Yes", "No"]);
  assert.equal(A.fillers.customValue(button), "");
  button.textContent = "No";
  assert.equal(A.fillers.customValue(button), "No");
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

test("education falls back to Other when the saved field of study is not an option", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div role="group" aria-labelledby="Education-section">
        <h4 id="Education-section">Education</h4>
        <div role="group" aria-labelledby="Education-1-panel">
          <h5 id="Education-1-panel">Education 1</h5>
          <div data-automation-id="formField-fieldOfStudy"><label>Field of Study</label><input data-uxi-widget-type="selectinput"></div>
        </div>
      </div>
    </div>`;
  const input = document.querySelector('[data-automation-id="formField-fieldOfStudy"] input');
  input.addEventListener("click", () => {
    document.querySelectorAll('[data-automation-id="promptOption"]').forEach((n) => n.remove());
    for (const text of ["Biology", "Other"]) {
      const option = document.createElement("div");
      option.dataset.automationId = "promptOption";
      option.textContent = text;
      Object.defineProperty(option, "offsetParent", { configurable: true, get: () => document.body });
      option.addEventListener("click", () => { input.dataset.selected = text; });
      option.hidden = false;
      document.body.append(option);
    }
  });
  input.addEventListener("input", () => {
    document.querySelectorAll('[data-automation-id="promptOption"]').forEach((o) => {
      o.style.display = o.textContent.toLowerCase().includes(input.value.toLowerCase()) ? "" : "none";
      Object.defineProperty(o, "offsetParent", { configurable: true, get: () => (o.style.display === "none" ? null : document.body) });
    });
  });
  A.fillers.sleep = async () => {};
  const p = testProfile(A);
  p.education = [{ school: "", degree: "", field: "Data Science" }];
  await A.engine.fillPage(p, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);
  assert.equal(input.dataset.selected, "Other");
});

test("skills: with nothing saved, skills named in work and education text are used", () => {
  const { A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.misc.skills = "";
  p.work = [{ title: "Data Analyst", company: "Globex", description: "Built dashboards in Tableau with SQL and Python; more SQL tuning" }];
  p.education = [{ school: "State University", degree: "BS", field: "Data Science" }];
  const picked = [...A.skills.select(p, "", A.skills.candidatesFor(p, ""), null)];
  assert.deepEqual(picked.slice(0, 1), ["SQL"]);
  for (const skill of ["Python", "Tableau", "Data Science"]) assert.ok(picked.includes(skill), skill);
  assert.ok(!picked.includes("Java"));
});

test("education fills a plain-text School or University box", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div role="group" aria-labelledby="Education-section">
        <h4 id="Education-section">Education</h4>
        <div role="group" aria-labelledby="Education-1-panel">
          <h5 id="Education-1-panel">Education 1</h5>
          <div data-automation-id="formField-schoolName"><label for="s">School or University</label><input type="text" id="s" name="schoolName"></div>
          <div data-automation-id="formField-firstYearAttended"><label>From</label><input role="spinbutton" data-automation-id="dateSectionYear-input"></div>
        </div>
      </div>
    </div>`;
  A.fillers.sleep = async () => {};
  const p = testProfile(A);
  p.education = [{ school: "UC San Diego", degree: "", field: "", startDate: "2022" }];
  await A.engine.fillPage(p, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);
  assert.equal(document.querySelector("#s").value, "UC San Diego");
  assert.equal(document.querySelector('[data-automation-id="dateSectionYear-input"]').getAttribute("aria-valuenow"), "2022");
});

test("Workday skills search runs on Enter, then the matching result is clicked", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div role="group" aria-labelledby="Skills-section">
        <h4 id="Skills-section">Skills</h4>
        <div data-automation-id="formField-skills"><label>Type to Add Skills</label>
          <input data-uxi-widget-type="selectinput" placeholder="Search"></div>
      </div>
    </div>`;
  const input = document.querySelector('[data-automation-id="formField-skills"] input');
  const selected = [];
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    document.querySelectorAll('[data-automation-id="promptOption"]').forEach((n) => n.remove());
    for (const text of ["Python (Programming Language)", "Something Else"]) {
      const option = document.createElement("div");
      option.dataset.automationId = "promptOption";
      option.textContent = text;
      Object.defineProperty(option, "offsetParent", { configurable: true, get: () => document.body });
      option.addEventListener("click", () => { selected.push(text); option.remove(); });
      document.body.append(option);
    }
  });
  A.fillers.sleep = async () => {};
  const p = testProfile(A);
  p.misc.skills = "Python";
  await A.engine.fillPage(p, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);
  assert.deepEqual(selected, ["Python (Programming Language)"]);
});

test("Workday skills section is left alone when skills filling is turned off", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div role="group" aria-labelledby="Skills-section">
        <h4 id="Skills-section">Skills</h4>
        <div data-automation-id="formField-skills"><label>Type to Add Skills</label>
          <input data-uxi-widget-type="selectinput" placeholder="Search"></div>
      </div>
    </div>`;
  const input = document.querySelector('[data-automation-id="formField-skills"] input');
  let touched = false;
  input.addEventListener("click", () => { touched = true; });
  input.addEventListener("input", () => { touched = true; });
  A.fillers.sleep = async () => {};
  assert.equal(A.DEFAULT_SETTINGS.fillSkills, true);
  const p = testProfile(A);
  p.misc.skills = "Python";
  const report = await A.engine.fillPage(p, { overwriteFilled: false, fillEEO: false, highlightFilled: false, fillSkills: false }, null);
  assert.equal(touched, false);
  assert.equal(input.value, "");
  assert.ok(!report.results.some((r) => /skill/i.test(r.label)));
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

test("skills: candidates mix saved skills with skills the posting names, whole terms only", () => {
  const { A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.misc.skills = "Python, Java, SQL";
  const jd = "We use JavaScript, k8s and Python daily. Strong Postgres a plus. Java experience welcome.";
  const names = A.skills.candidatesFor(p, jd).map((c) => c.skill);
  assert.deepEqual([...names.slice(0, 3)], ["Python", "Java", "SQL"]);
  assert.ok(names.includes("JavaScript") && names.includes("Kubernetes") && names.includes("PostgreSQL"));
  const jdOnlyJs = A.skills.candidatesFor({ ...p, misc: { skills: "" } }, "We write JavaScript.").map((c) => c.skill);
  assert.ok(!jdOnlyJs.includes("Java") && jdOnlyJs.includes("JavaScript"));
  assert.equal(A.skills.mentions("We write JavaScript.", "Java"), 0);
  assert.equal(A.skills.mentions("React and C++ roles", "R"), 0);
});

test("skills: local selection ranks saved skills by posting overlap and keeps evidenced posting skills", () => {
  const { A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.misc.skills = "Excel, Python, SQL";
  p.work = [{ title: "Engineer", company: "Globex", description: "Built Kubernetes tooling in Go" }];
  const jd = "SQL SQL SQL and Python. Kubernetes, Rust and Go are used.";
  const picked = A.skills.select(p, jd, A.skills.candidatesFor(p, jd), null);
  assert.deepEqual([...picked], ["SQL", "Python", "Go", "Kubernetes", "Excel"]);
  const many = Array.from({ length: 30 }, (_, i) => `Skill${i}`).join(",");
  p.misc.skills = many;
  assert.equal(A.skills.select(p, "", A.skills.candidatesFor(p, ""), null).length, 15);
});

test("skills: Jev verdicts decide, low-probability includes are dropped", () => {
  const { A } = loadFixture("workday-page2.html");
  const p = testProfile(A);
  p.misc.skills = "Python, SQL, Excel";
  const jd = "Python and SQL required.";
  const candidates = A.skills.candidatesFor(p, jd);
  const verdict = (inc, prob) => ({ choice: inc ? "INCLUDE" : "SKIP", probabilities: { INCLUDE: inc ? prob : 1 - prob, SKIP: inc ? 1 - prob : prob } });
  const verdicts = { answer_s0: verdict(true, 0.95), answer_s1: verdict(true, 0.5), answer_s2: verdict(false, 0.9) };
  assert.deepEqual([...A.skills.select(p, jd, candidates, verdicts)], ["Python"]);
  const request = A.skills.requestFor("m", p, jd, candidates);
  assert.deepEqual([...Object.keys(request.questions)], ["answer_s0", "answer_s1", "answer_s2"]);
  assert.equal(request.state.candidates.s1, "SQL");
});

test("fillPage picks Workday skills ranked by the stored posting description", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `
    <div data-automation-id="applyFlowPage">
      <div role="group" aria-labelledby="Skills-section">
        <h4 id="Skills-section">Skills</h4>
        <div data-automation-id="formField-skills"><label>Type to Add Skills</label>
          <input data-uxi-widget-type="selectinput" placeholder="Search"></div>
      </div>
    </div>`;
  const input = document.querySelector('[data-automation-id="formField-skills"] input');
  const selected = [];
  input.addEventListener("click", () => {
    document.querySelectorAll('[data-automation-id="promptOption"]').forEach((n) => n.remove());
    const option = document.createElement("div");
    option.dataset.automationId = "promptOption";
    option.textContent = input.value || "x";
    Object.defineProperty(option, "offsetParent", { configurable: true, get: () => document.body });
    option.addEventListener("click", () => { selected.push(option.textContent); option.remove(); });
    document.body.append(option);
  });
  input.addEventListener("input", () => {
    const option = document.querySelector('[data-automation-id="promptOption"]');
    if (option) option.textContent = input.value;
  });
  A.fillers.sleep = async () => {};
  const posting = document.createElement("div");
  posting.dataset.automationId = "jobPostingDescription";
  posting.textContent = "SQL, SQL and a little Python.";
  document.body.append(posting);
  const p = testProfile(A);
  p.misc.skills = "Excel, Python, SQL";
  await A.engine.fillPage(p, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);
  assert.deepEqual(selected.map((v) => v.toLowerCase()), ["sql", "python", "excel"]);
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

test("page4: EEO fields; terms consent is left for the applicant", () => {
  const { document, A } = loadFixture("workday-page4.html");
  const p = testProfile(A);

  // Consent and attestation checkboxes are the applicant's to tick.
  assertMapping(document, A, p, "consent to the terms and conditions", null);

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

const RACE_OPTIONS = [
  "American Indian or Alaska Native (Not Hispanic or Latino) (United States of America)",
  "Asian (Not Hispanic or Latino) (United States of America)",
  "White (Not Hispanic or Latino) (United States of America)",
];

// A Workday-style button dropdown whose popup is a wrapper (class mentions
// "option") around the options. Clicking the wrapper selects the highlighted
// (first) option, as the real list does; clicking an option selects it.
function raceDropdown(document) {
  document.body.innerHTML = `
    <div data-automation-id="formField-race">
      <button aria-haspopup="listbox" aria-label="Race/Ethnicity Select One">Select One</button>
    </div>
    <div class="css-optionsWrapper">
      <ul role="listbox">${RACE_OPTIONS.map((t) => `<li role="option">${t}</li>`).join("")}</ul>
    </div>`;
  const button = document.querySelector("button");
  for (const el of document.querySelectorAll("div.css-optionsWrapper, ul, li")) {
    Object.defineProperty(el, "offsetParent", { configurable: true, get: () => document.body });
  }
  document.querySelector(".css-optionsWrapper").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    button.textContent = li ? li.textContent : RACE_OPTIONS[0];
  });
  return button;
}

test("setReactSelect clicks the Asian option, not the list wrapper that holds every option", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  const button = raceDropdown(document);

  const ok = await A.fillers.setReactSelect(button, ["Asian"]);

  assert.equal(ok, true);
  assert.equal(button.textContent, RACE_OPTIONS[1]);
});

test("setReactSelect reports a dropdown that ends up on a different option", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  const button = raceDropdown(document);
  // The page ignores clicks on options and keeps selecting the first one.
  document.querySelectorAll("li").forEach((li) =>
    li.addEventListener("click", (e) => { e.stopPropagation(); button.textContent = RACE_OPTIONS[0]; })
  );

  const ok = await A.fillers.setReactSelect(button, ["Asian"]);

  assert.equal(ok, false);
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

test("current Workable controls use the shared ARIA dropdown path and skip hidden address inputs", async () => {
  const { document, A } = loadFixture(
    "workable-application.html",
    "https://apply.workable.com/goglobal/j/8E35097D4B/apply/"
  );
  const adapter = A.adapters.detect();
  assert.equal(adapter.name, "Workable");
  assert.ok(adapter.customSelectSelectors.includes('[role="combobox"]'));

  const visible = document.querySelectorAll("input, [role=combobox], [role=option]");
  for (const el of visible) el.getClientRects = () => [{ width: 200, height: 32 }];
  const code = document.querySelector('[aria-label="Telephone country code"]');
  const countryOption = document.querySelector('[role="option"]');
  countryOption.addEventListener("click", () => {
    code.dataset.selected = countryOption.textContent.trim();
  });
  A.fillers.sleep = async () => {};

  const report = await A.engine.fillPage(
    testProfile(A),
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  assert.equal(report.ats, "Workable");
  assert.equal(document.getElementById("firstname").value, "Alex");
  assert.equal(code.dataset.selected, "United States +1");
  for (const id of ["city", "postcode", "country"]) {
    assert.equal(document.getElementById(id).value, "", `${id} stays untouched`);
  }
});

test("current SmartRecruiters application is named and fills required email confirmation", async () => {
  const { document, A } = loadFixture(
    "smartrecruiters-application.html",
    "https://jobs.smartrecruiters.com/oneclick-ui/company/AccorHotel/publication/example"
  );
  const adapter = A.adapters.detect();
  assert.equal(adapter.name, "SmartRecruiters");
  assert.ok(adapter.customSelectSelectors.includes('[role="combobox"]'));

  for (const el of document.querySelectorAll("input, button, [role=option]")) {
    el.getClientRects = () => [{ width: 200, height: 32 }];
  }
  A.fillers.sleep = async () => {};

  const report = await A.engine.fillPage(
    testProfile(A),
    { overwriteFilled: false, fillEEO: false, highlightFilled: false },
    null
  );

  assert.equal(report.ats, "SmartRecruiters");
  assert.equal(document.getElementById("first-name-input").value, "Alex");
  assert.equal(document.getElementById("email-input").value, "alex.rivera@example.com");
  assert.equal(document.getElementById("confirm-email-input").value, "alex.rivera@example.com");
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

// --- Workday date helpers (#8) -----------------------------------------------
// parseDate and yearSpinPlan are the pure pieces of the calendar-icon popover
// date picker; the actual click-open-spin DOM interaction (popoverDatePass)
// needs a live Workday page that renders the popover and is not covered here.

test("workday.parseDate handles the date formats a Workday posting emits", () => {
  const win = blankWindow();
  const { parseDate } = win.AvidAutofill.workday;

  assert.deepEqual({ ...parseDate("March 2027") }, { mm: "03", dd: "", yyyy: "2027" });
  assert.deepEqual({ ...parseDate("August 11, 2026") }, { mm: "08", dd: "11", yyyy: "2026" });
  assert.deepEqual({ ...parseDate("03/2027") }, { mm: "03", dd: "", yyyy: "2027" });
  assert.deepEqual({ ...parseDate("2027-03-01") }, { mm: "03", dd: "01", yyyy: "2027" });
  assert.deepEqual({ ...parseDate("Jun 2025") }, { mm: "06", dd: "", yyyy: "2025" });
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("not a date"), null);
});

test("workday.yearSpinPlan computes the monthPicker spinner clicks to reach the target year", () => {
  const win = blankWindow();
  const { yearSpinPlan } = win.AvidAutofill.workday;

  // Target year is later -> spin the right (forward) spinner.
  assert.deepEqual({ ...yearSpinPlan(2024, 2027) }, { direction: "right", clicks: 3 });
  // Target year is earlier -> spin the left (back) spinner.
  assert.deepEqual({ ...yearSpinPlan(2027, 2020) }, { direction: "left", clicks: 7 });
  // Already on the target year -> no clicks (direction is a no-op either way).
  assert.deepEqual({ ...yearSpinPlan(2025, 2025) }, { direction: "right", clicks: 0 });
});

test("preferred first name uses the saved preferred name, not the first name", () => {
  const { window: win } = blankWindow();
  const A = win.AvidAutofill, profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  for (const signal of ["preferred first name*", "preferred_name | preferred first name*", "preferred name"]) {
    assert.equal(A.matcher.match(signal, profile, helpers).value, "Al", signal);
  }
  assert.equal(A.matcher.match("first name*", profile, helpers).value, "Alex");
  profile.personal.preferredName = "";
  assert.equal(A.matcher.match("preferred first name*", profile, helpers).value, "Alex");
});

test("Greenhouse Remix react-select questions are matched by their visible label", async () => {
  const { A, dom } = loadFixture("greenhouse-remix-application.html", "https://job-boards.greenhouse.io/gitlab/jobs/8698314002");
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }]; // jsdom has no layout
  try {
    const report = await A.engine.fillPage(testProfile(A), A.DEFAULT_SETTINGS, null);
    assert.equal(report.ats, "Greenhouse");
    const sponsorship = report.results.find(r => /require sponsorship/.test(r.label));
    assert.ok(sponsorship, `sponsorship question not matched; labels: ${report.results.map(r => r.label).join(" || ")}`);
    assert.equal(sponsorship.value, "No");
    assert.ok(!report.results.some(r => /employment agreements/.test(r.label)), "an agreements question is not the current employer");
  } finally { dom.window.close(); }
});

test("location autocomplete prefers the suggestion in the profile's state", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  const profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  assert.deepEqual(Array.from(A.matcher.match("location (city)*", profile, helpers).alts), ["Portland, California", "Portland, CA"]);
  document.body.innerHTML = `<label for="loc">Location (City)</label><div class="select__control"><input id="loc" role="combobox" aria-controls="loc-listbox"></div>`;
  const control = document.querySelector(".select__control"), input = document.getElementById("loc");
  let typed = "";
  input.addEventListener("input", () => { typed = input.value; });
  control.addEventListener("click", () => {
    if (document.getElementById("loc-listbox")) return;
    const box = document.createElement("div"); box.id = "loc-listbox";
    for (const text of ["Portland, Maine, United States", "Portland, California, United States"]) {
      const option = document.createElement("div"); option.setAttribute("role", "option"); option.textContent = text;
      option.getClientRects = () => [{}];
      option.addEventListener("click", () => { control.dataset.selected = text; box.remove(); });
      box.append(option);
    }
    document.body.append(box);
  });
  control.getClientRects = () => [{}];
  A.fillers.sleep = async () => {};
  await A.engine.fillPage(profile, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);
  assert.equal(typed, "portland, california"); // setReactSelect types the normalized target
  assert.equal(control.dataset.selected, "Portland, California, United States");
});

test("sponsorship and relocation questions get the answer they actually ask for", () => {
  const A = blankWindow().AvidAutofill, profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  profile.misc.willingToRelocate = "Yes";
  const answer = signal => A.matcher.match(signal, profile, helpers)?.value ?? null;
  assert.equal(answer("will you now or in the future require company sponsorship to retain or extend your work authorization in the country where the job is located?*"), "No");
  assert.equal(answer("do you require visa sponsorship?"), "No");
  assert.equal(answer("are you authorized to work in the us without sponsorship?"), "Yes");
  assert.equal(answer("are you legally authorized to work in the country where this job is located?"), "Yes");
  assert.equal(answer("are you willing to relocate?"), "Yes");
  assert.equal(answer("are you open to relocation to the uk?*"), null);
  assert.equal(answer("are you open to relocation to the middle east? *"), null);
  assert.equal(answer("will you require relocation assistance?"), null);
});

test("Scale AI Greenhouse form: sponsorship is No and destination relocation is left for review", async () => {
  const { A, dom } = loadFixture("greenhouse-remix-scaleai.html", "https://job-boards.greenhouse.io/scaleai/jobs/4413992005");
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }];
  try {
    const profile = testProfile(A); profile.misc.willingToRelocate = "Yes";
    const report = await A.engine.fillPage(profile, A.DEFAULT_SETTINGS, null);
    assert.equal(report.results.find(r => /require company sponsorship/.test(r.label))?.value, "No");
    assert.ok(!report.results.some(r => /relocation to the/.test(r.label)), "destination relocation questions are not answered from general willingness");
  } finally { dom.window.close(); }
});

test("Lever card radio groups are matched by their question text", async () => {
  const { A, dom } = loadFixture("lever-application.html", "https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply");
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }];
  try {
    const radios = Array.from(dom.window.document.querySelectorAll('input[name="cards[1c719ca9-5069-4afe-9e82-39ca420e0edb][field1]"]'));
    assert.match(A.matcher.groupSignal(radios), /require sponsorship for employment visa status/);
    await A.engine.fillPage(testProfile(A), A.DEFAULT_SETTINGS, null);
    assert.equal(radios.find(r => r.checked)?.value, "No");
  } finally { dom.window.close(); }
});

test("profile links do not answer questions that only mention the platform", () => {
  const A = blankWindow().AvidAutofill, profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  profile.links.github = "https://github.com/alexrivera";
  const answer = signal => A.matcher.match(signal, profile, helpers)?.value ?? null;
  for (const signal of ["github profile", "github url", "link to your github", "*github profile github profile"]) assert.equal(answer(signal), profile.links.github, signal);
  assert.equal(answer("*share 2–3 of your open-source contributions with links (github prs, issues, etc.)"), null);
  assert.equal(answer("link to a github repository for a project you are proud of"), null);
});

test("name pronunciation questions are not answered with the legal name", () => {
  const A = blankWindow().AvidAutofill, profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  assert.equal(A.matcher.match("type your response | name pronunciation | how do you pronounce your name? | cards a69a985a field2", profile, helpers), null);
  assert.equal(A.matcher.match("phonetic spelling of your name", profile, helpers), null);
  assert.equal(A.matcher.match("type your response | preferred name | what would you like us to call you?", profile, helpers).value, "Al");
  assert.equal(A.matcher.match("your name", profile, helpers).value, "Alex Rivera");
});

test("preferred-name questions phrased as what to call you use the preferred name", () => {
  const A = blankWindow().AvidAutofill, profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  assert.equal(A.matcher.match("what's the name you'd prefer us to use throughout the interview process?", profile, helpers).value, "Al");
  assert.equal(A.matcher.match("what name would you like us to call you?", profile, helpers).value, "Al");
  profile.personal.preferredName = "";
  assert.equal(A.matcher.match("what's the name you'd prefer us to use throughout the interview process?", profile, helpers).value, "Alex");
});

test("location questions naming countries are answered from the profile country", () => {
  const A = blankWindow().AvidAutofill, profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  const answer = signal => A.matcher.match(signal, profile, helpers)?.value ?? null;
  // GitLab's wording, typo included.
  assert.equal(answer("are you currently location in either canada, uk or poland?*"), "No");
  assert.equal(answer("are you located in the united states?"), "Yes");
  assert.equal(answer("are you currently based in the usa or canada?"), "Yes");
  assert.equal(answer("are you located in london, united kingdom?"), "No");
  // Nothing that could be the applicant's country may be read as "No".
  assert.equal(answer("are you located in the us or canada?"), null);
  assert.equal(answer("are you located in new jersey or new york?"), null);
  assert.equal(answer("are you located in the san francisco bay area?"), null);
  // Willingness, commuting and work-permission questions are different questions.
  assert.equal(answer("are you located in or willing to relocate to canada?"), null);
  assert.equal(answer("do you live within commuting distance of toronto, canada?"), null);
  assert.equal(answer("are you located in poland and able to work there?"), null);
  profile.personal.country = "Canada";
  assert.equal(answer("are you currently location in either canada, uk or poland?*"), "Yes");
  assert.equal(answer("are you located in the united states?"), "No");
});

test("acknowledgement boxes are ticked unless the applicant turns that off", async () => {
  const { document, AvidAutofill: A } = blankWindow();
  const profile = testProfile(A), helpers = A.matcher.makeHelpers(profile);
  for (const signal of ["i agree", "i certify that the information provided is true", "i acknowledge the privacy notice", "i have read and understand the terms", "accept terms and conditions"]) {
    assert.equal(A.matcher.match(signal, profile, helpers), null, signal);
  }
  document.body.innerHTML = '<form><label><input type="checkbox" id="agree"> I agree to the processing of my data</label></form>';
  document.getElementById("agree").getClientRects = () => [{}];
  await A.engine.fillPage(profile, { ...A.DEFAULT_SETTINGS, tickAcknowledgements: false }, null);
  assert.equal(document.getElementById("agree").checked, false);
  await A.engine.fillPage(profile, A.DEFAULT_SETTINGS, null);
  assert.equal(document.getElementById("agree").checked, true);
});

test("Lever location search picks the suggestion in the profile's state", async () => {
  const win = blankWindow();
  const { document, AvidAutofill: A } = win;
  document.body.innerHTML = `<form class="application-form"><div class="application-question"><label>Current location ✱</label>
    <div class="application-field"><input class="location-input" id="location-input" type="text" name="location"><input id="selected-location" type="hidden" name="selectedLocation">
    <div class="dropdown-container"><div class="dropdown-results"></div><div class="dropdown-no-results">No location found. Try entering a different location</div></div></div></div></form>`;
  const input = document.getElementById("location-input"), results = document.querySelector(".dropdown-results");
  input.getClientRects = () => [{}];
  // Lever searches on keydown and selects on mousedown (jQuery handlers).
  input.addEventListener("keydown", () => {
    results.innerHTML = ["Portland, ME, USA", "Portland, CA, USA"].map((name, i) => `<div class="dropdown-location" id="location-${i}">${name}</div>`).join("");
  });
  document.addEventListener("mousedown", (event) => {
    const option = event.target.closest(".dropdown-location");
    if (!option) return;
    input.value = option.textContent;
    document.getElementById("selected-location").value = JSON.stringify({ name: option.textContent });
    results.innerHTML = "";
  });
  A.fillers.sleep = async () => {};
  const report = await A.engine.fillPage(testProfile(A), { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);
  assert.equal(input.value, "Portland, CA, USA");
  assert.equal(document.getElementById("selected-location").value, '{"name":"Portland, CA, USA"}');
  assert.equal(report.results.find(r => /location/.test(r.label))?.status, "filled");
});

test("fillPage answers a captured Ashby form: yes/no buttons, pronouns, LinkedIn, gender and race", async () => {
  const { document, A, dom } = loadFixture("ashby-application.html", "https://jobs.ashbyhq.com/example/job/application");
  dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  // Ashby's buttons only change state through their click handler.
  document.querySelectorAll(".ashby-application-form-input-yesno-option").forEach((b) =>
    b.addEventListener("click", () => {
      b.parentElement.querySelectorAll("button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    })
  );
  const profile = testProfile(A);
  Object.assign(profile.personal, { pronouns: "he/him" });
  profile.eeo.gender = "Male";
  profile.eeo.race = "Asian";
  profile.workAuth = { authorizedToWork: "Yes", requireSponsorship: "No" };
  await A.engine.fillPage(profile, { overwriteFilled: false, fillEEO: true, highlightFilled: false }, null);

  const pressed = (path) =>
    document.querySelector(`[data-field-path="${path}"] button[aria-pressed="true"]`)?.textContent;
  assert.equal(pressed("1cd98c1a-3766-498b-8ab7-f7e325a11883"), "Yes", "onsite");
  assert.equal(pressed("28aa6e1c-b695-442a-adea-8ac56073529d"), "Yes", "work authorization");
  assert.equal(pressed("c86cc07c-951c-46a2-8804-dfdbc4a00150"), "No", "sponsorship");
  const value = (id) => document.getElementById(id).value;
  assert.equal(value("ad70a2c7-3548-440d-bd8f-4b72c54fc521"), "he/him", "pronouns");
  assert.equal(value("36e042a7-71c3-4d17-a72f-54d355a547b9"), "", "name pronunciation is not the pronouns field");
  assert.equal(value("aebd5254-2ac1-40d3-827f-01e4eaadaf29"), "https://linkedin.com/in/alexrivera", "LinkedIn");
  const checked = (name) => document.querySelector(`input[type="radio"][name$="${name}"]:checked`)?.id;
  assert.match(checked("_systemfield_eeoc_gender"), /gender-labeled-radio-0$/);
  assert.match(checked("_systemfield_eeoc_race"), /race-labeled-radio-4$/);
  // The relocation question keeps its own answer, not a neighbour's.
  assert.match(checked("fb61f6eb-5a53-477d-9f04-8f6118f14a4f"), /radio-0$/);
});

test("fillPage fills a second captured Ashby form without misreading long questions", async () => {
  const { document, A, dom } = loadFixture("ashby-application-2.html", "https://jobs.ashbyhq.com/example/job/application");
  dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  document.querySelectorAll(".ashby-application-form-input-yesno-option").forEach((b) =>
    b.addEventListener("click", () => {
      b.parentElement.querySelectorAll("button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    })
  );
  // Ashby comboboxes list their options in a popup once typed into.
  const optionsFor = {
    "What is your work location": ["Austin, TX", "Portland, OR"],
    "If this role requires a security clearance": ["None", "Secret", "Top Secret"],
    "Please select the country you hold citizenship in": ["Canada", "United States", "United States Minor Outlying Islands"],
    "If you hold citizenship in a second country": ["None", "Canada", "United States"],
  };
  document.querySelectorAll('[role="combobox"]').forEach((input) => {
    const label = input.closest("[data-field-path]").querySelector("label").textContent;
    const title = Object.keys(optionsFor).find((t) => label.startsWith(t));
    input.addEventListener("input", () => {
      document.querySelectorAll("[data-popup]").forEach((n) => n.remove());
      const popup = document.createElement("div");
      popup.setAttribute("data-popup", "");
      for (const text of optionsFor[title] || []) {
        const option = document.createElement("div");
        option.setAttribute("role", "option");
        option.textContent = text;
        option.addEventListener("click", () => { input.value = text; popup.remove(); });
        popup.append(option);
      }
      document.body.append(popup);
    });
  });
  const profile = testProfile(A);
  Object.assign(profile.personal, { city: "Austin", state: "TX" });
  profile.misc.salaryExpectation = "100,000-130,000";
  profile.misc.noticePeriod = "one month";
  profile.questions.remoteExperience = "Yes, hybrid";
  profile.links.portfolio = "https://alex.example.dev";
  await A.engine.fillPage(profile, { overwriteFilled: false, fillEEO: false, highlightFilled: false }, null);

  const entryFor = (title) =>
    Array.from(document.querySelectorAll("[data-field-path]")).find((e) => e.querySelector("label")?.textContent.startsWith(title));
  const answer = (title) => entryFor(title).querySelector("input:not([type=checkbox]), textarea").value;
  const pressedFor = (title) => entryFor(title).querySelector('button[aria-pressed="true"]')?.textContent;
  assert.equal(pressedFor("Are you able and willing to work from our Los Angeles"), "Yes", "office attendance");
  assert.equal(pressedFor("Are you legally authorized"), "Yes");
  assert.equal(pressedFor("Will you now or in the future require visa sponsorship"), "No");
  assert.equal(pressedFor("On-Call Requirements"), "Yes");
  assert.equal(pressedFor("Outside Work and Advisory Disclosure"), "No");
  assert.equal(pressedFor("Have you heard of TRM"), undefined, "unknown yes/no questions are left for Jev");
  const chosen = (title) => entryFor(title).querySelector('input[type="radio"]:checked')?.id;
  assert.match(chosen("What is your current notice period"), /radio-2$/, "one month -> the 1 month option");
  assert.match(chosen("Have you previously worked in a remote or hybrid"), /radio-1$/);
  assert.equal(answer("If this role requires a security clearance"), "None");
  assert.equal(answer("Please select the country you hold citizenship in"), "United States");
  assert.equal(answer("If you hold citizenship in a second country"), "None");
  assert.equal(answer("Please provide relevant work samples"), "https://alex.example.dev");
  assert.equal(answer("What is your work location"), "Austin, TX");
  assert.equal(answer("Please list your most recent employer"), "Globex");
  assert.equal(answer("Please share your base compensation"), "100000", "a number input gets the first number of a salary range");
  assert.equal(answer("Why are you considering leaving"), "", "a 'why leaving' question is not the job title");
  assert.equal(answer("If yes, please provide details"), "", "a follow-up for details is not the sponsorship answer");
  for (const id of ["764b6651", "b8b84bc4", "5a49f203"]) {
    assert.ok(document.querySelector(`input[type="radio"][name*="${id}"]:checked`), `acknowledgement ${id} is ticked`);
  }
});

test("notice periods match the option covering the same length of time", () => {
  const { A } = loadFixture("ashby-application-2.html");
  const options = ["1-2 weeks", "3-4 weeks", "1 month", "2 months", "3+ months"];
  const pick = (v) => options[A.matcher.nearestDuration(v, options)];
  assert.equal(pick("2 weeks"), "1-2 weeks");
  assert.equal(pick("4 weeks"), "3-4 weeks");
  assert.equal(pick("30 days"), "1 month");
  assert.equal(pick("six months"), "3+ months");
  assert.equal(pick("Immediately"), "1-2 weeks");
  assert.equal(A.matcher.nearestDuration("June 1, 2027", options), -1);
});

test("Ashby fill waits for Ashby's own resume parse to finish before filling", async () => {
  const { document, A, dom } = loadFixture("ashby-application-2.html", "https://jobs.ashbyhq.com/example/job/application");
  const adapter = A.adapters.detect();
  assert.equal(adapter.name, "Ashby");
  const layer = document.querySelector(".ashby-application-form-autofill-input-pending-layer");
  const fast = () => new Promise((resolve) => dom.window.setTimeout(resolve, 5));
  let parsed = false;
  dom.window.setTimeout(() => layer.setAttribute("data-state", "visible"), 20);
  dom.window.setTimeout(() => { layer.setAttribute("data-state", "hidden"); parsed = true; }, 150);
  await adapter.resumeParse(fast);
  assert.equal(parsed, true, "returns only after the parsing layer hides again");
  // No parse started: returns after the short start window.
  await adapter.resumeParse(fast);
});
