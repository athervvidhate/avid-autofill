import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { JSDOM } from "jsdom";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const clone = value => structuredClone(value);
const modelContext = vm.createContext({ URL, Date });
vm.runInContext(read("src/shared/tracker-model.js"), modelContext);
const M = modelContext.AvidAutofill.trackerModel;
const postingHtml = `<h1>Software Engineer</h1><form><label for="resume">Resume</label><input id="resume" type="file"><input type="email"><button>Submit application</button></form>`;
const job = { company: "Acme", role: "Software Engineer", location: "Denver", url: "https://acme.test/careers/engineer" };
const entry = { ...job, status: "Applied", applied: "2026-09-04", followUp: "", notes: "" };
const sender = { id: "test", tab: { id: 1 }, frameId: 0, url: job.url };
const admin = { id: "test", url: "chrome-extension://test/src/options/options.html" };
const connection = { sub: "account1", email: "person@example.test", connected: true, spreadsheetId: "sheet1", sheetId: 0, templateVersion: 1 };
function detector(html = postingHtml, url = job.url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(read("src/shared/tracker-model.js"));
  dom.window.eval(read("src/content/job-detector.js"));
  return dom;
}
function backend(saved = {}, sessionSaved = {}) {
  const local = { avidTracker: clone(saved) }, session = clone(sessionSaved), listeners = [], storageListeners = [];
  const rows = [Array.from(M.HEADERS)], markers = new Map(), writes = [], calls = [];
  let failWrite = false, loseWrite = false, createCount = 0, authTransform = url => url;
  const event = () => ({ addListener() {} });
  const storage = (data, name) => ({
    async get(key) { return clone({ [key]: data[key] }); },
    async set(values) { for (const [key, value] of Object.entries(values)) { const oldValue = data[key]; data[key] = clone(value); storageListeners.forEach(fn => fn({ [key]: { oldValue, newValue: clone(value) } }, name)); } },
    async remove(key) { delete data[key]; },
  });
  const chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => listeners.push(fn) }, onInstalled: event(), onStartup: event() },
    storage: { local: storage(local, "local"), session: storage(session, "session"), onChanged: { addListener: fn => storageListeners.push(fn) } },
    identity: { getRedirectURL: path => `https://test.chromiumapp.org/${path}`, async launchWebAuthFlow({ url }) {
      const request = new URL(url);
      const result = new URL(request.searchParams.get("redirect_uri"));
      result.hash = new URLSearchParams({ state: request.searchParams.get("state"), token_type: "Bearer", access_token: "test-only-token", expires_in: "3600", scope: "https://www.googleapis.com/auth/drive.file openid email" }).toString();
      return authTransform(result.href);
    } },
    permissions: { async contains() { return true; }, onRemoved: event() },
    scripting: { async getRegisteredContentScripts() { return []; }, async registerContentScripts() {}, async unregisterContentScripts() {}, async executeScript() {} },
    tabs: { async query() { return []; }, async create() {}, async sendMessage() { throw new Error("No parent tracker"); }, onRemoved: event() },
    alarms: { async create() {}, onAlarm: event() },
  };
  function response(data, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return clone(data); } }; }
  const fetch = async (value, options = {}) => {
    const url = new URL(value), body = options.body && JSON.parse(options.body);
    calls.push({ url: url.href, body, method: options.method });
    if (url.hostname === "openidconnect.googleapis.com") return response({ sub: "account1", email: "person@example.test", email_verified: true });
    if (url.hostname === "www.googleapis.com") {
      if (options.method === "POST") { createCount++; return response({ id: "sheet1" }); }
      return response({ files: createCount ? [{ id: "sheet1" }] : [] });
    }
    assert.equal(url.hostname, "sheets.googleapis.com");
    assert.equal(options.headers.Authorization, "Bearer test-only-token");
    if (url.pathname.includes("/developerMetadata/")) {
      const id = Number(url.pathname.split("/").pop());
      return markers.has(id) ? response(markers.get(id)) : response({}, 404);
    }
    if (url.pathname.endsWith("values:batchGetByDataFilter")) {
      const grid = body.dataFilters[0].gridRange;
      const values = rows.slice(grid.startRowIndex || 0, grid.endRowIndex).map(row => row.slice(grid.startColumnIndex || 0, grid.endColumnIndex));
      return response({ valueRanges: [{ valueRange: { values } }] });
    }
    if (url.pathname.endsWith(":batchUpdate")) {
      if (failWrite) throw new Error("Offline");
      const marker = body.requests.find(r => r.createDeveloperMetadata)?.createDeveloperMetadata.developerMetadata;
      if (marker && markers.has(marker.metadataId)) return response({}, 400);
      const append = body.requests.find(r => r.appendCells)?.appendCells;
      const header = body.requests.find(r => r.updateCells?.start?.rowIndex === 0)?.updateCells;
      if (header) rows[0] = header.rows[0].values.map(v => v.userEnteredValue.stringValue);
      for (const clear of body.requests.filter(r => r.updateCells?.fields === "userEnteredValue" && r.updateCells.start.rowIndex > 0)) rows[clear.updateCells.start.rowIndex][clear.updateCells.start.columnIndex] = "";
      if (append) { rows.push(append.rows[0].values.map(v => v.userEnteredValue?.stringValue ?? v.userEnteredValue?.numberValue ?? "")); writes.push(body); }
      if (marker) markers.set(marker.metadataId, marker);
      if (loseWrite) { loseWrite = false; throw new Error("Response lost"); }
      return response({});
    }
    return response({ sheets: [{ properties: { sheetId: 0, title: "Applications" } }] });
  };
  const context = vm.createContext({ chrome, fetch, crypto: crypto.webcrypto, URL, URLSearchParams, TextEncoder, Uint8Array, Uint32Array, AbortSignal, Date, console });
  for (const path of ["src/shared/tracker-model.js", "src/background/google-config.js", "src/background/tracker.js"]) vm.runInContext(read(path), context);
  const request = (action, data = {}, from = sender) => new Promise((resolve, reject) => {
    for (const listener of listeners) if (listener({ type: `AVID_TRACKER_${action}`, ...data }, from, resolve) === true) return;
    reject(new Error("No message listener"));
  });
  return { chrome, local, session, rows, markers, writes, calls, request, get createCount() { return createCount; }, set failWrite(value) { failWrite = value; }, set loseWrite(value) { loseWrite = value; }, set authTransform(value) { authTransform = value; } };
}
function connected(saved = {}) {
  return backend({ connection, ...saved }, { avidGoogleToken: { token: "test-only-token", sub: "account1", expiresAt: Date.now() + 3600000 } });
}
const add = (b, value = entry, again = false, operationId = crypto.randomUUID()) => b.request("ADD", { entry: value, again, operationId });

test("enabling tracking stays responsive while an existing tab cannot finish script injection", async () => {
  const b = backend();
  let release, injected = false;
  b.chrome.tabs.query = async () => [{ id: 1 }];
  b.chrome.scripting.executeScript = () => { injected = true; return new Promise(resolve => { release = resolve; }); };
  let timeout;
  try {
    const result = await Promise.race([
      b.request("ENABLE", { enabled: true }, admin),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Connections stuck on Saving while a tab waits to inject")), 200); }),
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.enabled, true);
    assert.equal(injected, true);
    assert.equal((await b.request("STATE", {}, admin)).enabled, true);
  } finally { clearTimeout(timeout); release?.(); }
});

test("job identity removes applicant/marketing data and preserves requisition identity", () => {
  assert.equal(M.jobKey("https://jobs.lever.co/acme/abc/apply?utm_source=ad&email=private"), M.jobKey("https://jobs.lever.co/acme/abc"));
  assert.equal(M.jobKey("https://acme.test/careers?gh_jid=123&utm_source=ad"), M.jobKey("https://job-boards.greenhouse.io/acme/jobs/123"));
  assert.notEqual(M.jobKey("https://jobs.test/apply?jobId=1"), M.jobKey("https://jobs.test/apply?jobId=2"));
  assert.equal(M.jobKey("https://acme.test/#/jobs/123/apply?email=private"), M.jobKey("https://acme.test/#/jobs/123"));
  assert.equal(M.jobUrl("javascript:alert(1)"), "");
  assert.equal(M.jobUrl("https://user:secret@acme.test/job"), "");
});

test("unknown career form is detected; upload, hidden text, conditional prose and generic thanks are not confirmation", () => {
  const dom = detector();
  const inspect = () => dom.window.AvidAutofill.jobDetector.inspect();
  assert.equal(inspect().isJob, true);
  assert.equal(inspect().confirmed, false);
  for (const message of ["Your resume was successfully uploaded", "Thank you for your interest", "When your application has been submitted, you will get an email.", "Your application was not submitted."]) {
    dom.window.document.body.insertAdjacentHTML("beforeend", `<p>${message}</p>`);
    assert.equal(inspect().confirmed, false, message);
  }
  dom.window.document.body.insertAdjacentHTML("beforeend", '<p hidden>Your application was submitted</p><div style="display:none">Thank you for applying</div>');
  assert.equal(inspect().confirmed, false);
  dom.window.document.body.innerHTML = "<h1>We have received your application</h1>";
  assert.equal(inspect().confirmed, true);
  dom.window.document.body.innerHTML = "<p>Your application has been submitted. We will be in touch if you are selected.</p>";
  assert.equal(inspect().confirmed, true);
  dom.window.close();
  const login = detector('<h1>Careers</h1><form><input type="email"><input type="password"><button>Sign in</button></form>');
  assert.equal(login.window.AvidAutofill.jobDetector.inspect().isJob, false);
  login.window.close();
  const plain = detector('<div>We have received your application. We will be in touch.</div>', "https://acme.test/thanks");
  assert.equal(plain.window.AvidAutofill.jobDetector.inspect().confirmed, true);
  plain.window.close();
});

test("JSON-LD and canonical posting survive an application URL", () => {
  const dom = detector(`<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "JobPosting", title: "Engineer", hiringOrganization: { name: "Acme" }, jobLocation: { address: { addressLocality: "Denver", addressRegion: "CO" } }, url: job.url }] })}</script>${postingHtml}`, `${job.url}/apply?source=ad`);
  const result = dom.window.AvidAutofill.jobDetector.inspect();
  assert.equal(result.job.company, "Acme"); assert.equal(result.job.role, "Engineer");
  assert.equal(result.job.location, "Denver, CO"); assert.equal(result.job.url, job.url);
  dom.window.close();
});

test("captured Workday intermediate steps do not trigger submitted tracking", () => {
  for (let step = 1; step <= 5; step++) {
    const dom = detector(read(`test/fixtures/workday-page${step}.html`), "https://philips.wd3.myworkdayjobs.com/en-US/jobs-and-careers/job/Nashville/Graduate_R123/apply");
    const result = dom.window.AvidAutofill.jobDetector.inspect();
    assert.equal(result.confirmed, false, `step ${step}`);
    assert.match(result.job.role, /Graduate Development Program/, `role on step ${step}`);
    dom.window.close();
  }
});

test("confirmation uses saved posting details across navigation, asks once, and dismissal survives a new tab", async () => {
  const b = backend({ enabled: true });
  assert.equal((await b.request("CAPTURE", { snapshot: { job, isJob: true, application: true } })).preview, undefined);
  const snapshot = { job: { url: "https://acme.test/thank-you" }, confirmed: true, confirmationContext: false };
  const submittedSender = { ...sender, url: "https://acme.test/thank-you" };
  const submitted = await b.request("CAPTURE", { snapshot }, submittedSender);
  assert.equal(submitted.preview.job.role, job.role);
  assert.equal(submitted.preview.job.url, job.url);
  assert.equal(submitted.preview.confirmed, true);
  assert.equal((await b.request("CAPTURE", { snapshot }, submittedSender)).preview, undefined);
  await b.request("DISMISS", { url: job.url });
  assert.equal((await b.request("CAPTURE", { snapshot: { job, isJob: true, confirmed: true, confirmationContext: true } }, { ...sender, tab: { id: 2 } })).preview, undefined);
  assert.equal((await b.request("PREVIEW", {}, submittedSender)).preview.job.role, job.role);
});

test("a confirmation on an unrelated origin cannot inherit a previous application", async () => {
  const b = backend({ enabled: true });
  await b.request("CAPTURE", { snapshot: { job, isJob: true } });
  const result = await b.request("CAPTURE", { snapshot: { job: { url: "https://unrelated.test/thanks" }, confirmed: true, confirmationContext: false } }, { ...sender, url: "https://unrelated.test/thanks" });
  assert.equal(result.preview, undefined);
});

test("embedded confirmations route one prompt to the parent document", async () => {
  const b = backend({ enabled: true });
  const routed = [];
  b.chrome.tabs.sendMessage = async (tabId, msg, options) => { routed.push({ tabId, msg, options }); return { ok: true }; };
  const frame = { ...sender, frameId: 3 };
  await b.request("CAPTURE", { snapshot: { job, isJob: true } }, frame);
  const snapshot = { job, confirmed: true, confirmationContext: true };
  assert.equal((await b.request("CAPTURE", { snapshot }, frame)).preview, undefined);
  assert.equal(routed.length, 1); assert.equal(routed[0].options.frameId, 0);
  assert.equal(routed[0].msg.preview.job.role, job.role);
  assert.equal((await b.request("CAPTURE", { snapshot }, sender)).preview, undefined);
});

test("approved entries survive offline saves and retry a lost response without duplicate rows", async () => {
  const b = connected();
  b.failWrite = true;
  let result = await add(b);
  assert.equal(result.ok, true); assert.equal(result.record.state, "pending"); assert.equal(b.local.avidTracker.entries.length, 1);
  b.failWrite = false; b.loseWrite = true;
  await b.request("RETRY", {}, admin);
  assert.equal(b.local.avidTracker.entries[0].state, "synced"); assert.equal(b.rows.length, 2);
  result = await add(b);
  assert.equal(result.record.state, "synced"); assert.equal(b.rows.length, 2);
  assert.equal(b.writes.length, 1);
  assert.ok(b.writes[0].requests.some(r => r.createDeveloperMetadata));
});

test("explicit reapplication creates one extra row even if its Add request repeats", async () => {
  const b = connected();
  await add(b);
  const operation = crypto.randomUUID();
  await add(b, entry, true, operation); await add(b, entry, true, operation);
  assert.equal(b.rows.length, 3);
  assert.notEqual(b.rows[1][8], b.rows[2][8]);
});

test("an interrupted worker recovers a remotely saved entry from its durable pending state", async () => {
  const first = connected();
  first.failWrite = true;
  await add(first);
  const pending = clone(first.local.avidTracker);
  first.failWrite = false;
  await first.request("RETRY", {}, admin);
  const restarted = connected(pending);
  restarted.rows.splice(0, restarted.rows.length, ...clone(first.rows));
  for (const [id, marker] of first.markers) restarted.markers.set(id, clone(marker));
  await restarted.request("RETRY", {}, admin);
  assert.equal(restarted.local.avidTracker.entries[0].state, "synced");
  assert.equal(restarted.rows.length, 2); assert.equal(restarted.writes.length, 0);
});

test("metadata ID collisions are resolved without overwriting another application", async () => {
  const b = connected();
  const digest = crypto.createHash("sha256").update(M.jobKey(entry.url)).digest("hex");
  const collisionId = parseInt(digest.slice(0, 7), 16) + 2;
  b.markers.set(collisionId, { metadataId: collisionId, metadataKey: "avidApplication", metadataValue: "another-entry" });
  assert.equal((await add(b)).record.state, "pending");
  assert.notEqual(b.local.avidTracker.entries[0].metadataId, collisionId);
  await b.request("RETRY", {}, admin);
  assert.equal(b.local.avidTracker.entries[0].state, "synced");
  assert.equal(b.markers.get(collisionId).metadataValue, "another-entry");
  assert.equal(b.rows.length, 2);
});

test("sheet edits are kept and an existing remote posting is not appended again", async () => {
  const b = connected();
  b.rows.push(["Acme", "Software Engineer", entry.url, "Denver", "", "Interview", "", "My own notes", "remote-id", M.jobKey(entry.url)]);
  const result = await add(b);
  assert.equal(result.record.state, "synced"); assert.equal(result.record.duplicate, true);
  assert.equal(b.rows.length, 2); assert.equal(b.rows[1][5], "Interview"); assert.equal(b.rows[1][7], "My own notes");
  b.rows[0][0] = "Renamed column";
  await add(b, { ...entry, url: `${entry.url}-2` });
  assert.equal(b.local.avidTracker.entries[1].state, "pending");
  assert.match(b.local.avidTracker.entries[1].error, /columns changed/);
  assert.equal(b.rows.length, 2);
});

test("validation and explicit string cells prevent spreadsheet formula injection", async () => {
  const b = connected();
  assert.equal((await add(b, { ...entry, company: "" })).ok, false);
  assert.equal((await add(b, { ...entry, applied: "2026-02-30" })).ok, false);
  assert.equal((await add(b, { ...entry, status: "=IMPORTXML()" })).ok, false);
  await add(b, { ...entry, company: '=IMPORTXML("https://bad.test", "//x")', notes: "+SUM(1,2)" });
  const cells = b.writes[0].requests[0].appendCells.rows[0].values;
  assert.equal(cells[0].userEnteredValue.stringValue, '=IMPORTXML("https://bad.test", "//x")');
  assert.equal(cells[0].userEnteredValue.formulaValue, undefined);
  assert.equal(cells[7].userEnteredValue.stringValue, "+SUM(1,2)");
  assert.equal(typeof cells[4].userEnteredValue.numberValue, "number");
  assert.equal(cells[1].userEnteredFormat.wrapStrategy, "WRAP");
  assert.equal(cells[6].userEnteredFormat.numberFormat.type, "DATE");
});

test("applied entries get deterministic date defaults before saving", () => {
  const result = M.entry({ ...entry, applied: "", followUp: "" });
  assert.equal(result.applied, M.today());
  assert.equal(result.followUp, M.daysFromToday(7));
});

test("saved entries also get deterministic date defaults before saving", () => {
  const result = M.entry({ ...entry, status: "Saved", applied: "", followUp: "" });
  assert.equal(result.applied, M.today());
  assert.equal(result.followUp, M.daysFromToday(7));
});

test("Google setup is limited to Connections, checks OAuth state, and keeps tokens out of local storage", async () => {
  const b = backend({ clientId: "example.apps.googleusercontent.com" });
  assert.equal((await b.request("CONNECT")).ok, false);
  b.authTransform = url => url.replace(/state=[^&]+/, "state=wrong");
  assert.equal((await b.request("CONNECT", {}, admin)).ok, false);
  assert.equal(b.calls.length, 0);
  b.authTransform = url => url;
  const result = await b.request("CONNECT", {}, { ...admin, tab: { id: 9 } });
  assert.equal(result.ok, true, result.error); assert.equal(b.createCount, 1);
  assert.equal(b.local.avidTracker.connection.spreadsheetId, "sheet1");
  assert.equal(b.local.avidTracker.connection.templateVersion, 3);
  assert.equal(b.local.avidTracker.connection.columns.length, 10);
  assert.equal(JSON.stringify(b.local).includes("test-only-token"), false);
  assert.ok(b.session.avidGoogleToken);
  await b.request("CONNECT", {}, admin);
  assert.equal(b.createCount, 1);
  await b.request("DISCONNECT", {}, admin);
  assert.equal(b.session.avidGoogleToken, undefined);
  assert.equal(b.local.avidTracker.connection.spreadsheetId, "sheet1");
});

test("formatted sheet keeps headers, filter, date formats, dropdowns and hidden identifiers", () => {
  const requests = M.template(0);
  assert.equal(requests[0].updateSheetProperties.properties.gridProperties.frozenRowCount, 1);
  assert.equal(requests.find(r => r.setBasicFilter).setBasicFilter.filter.range.endColumnIndex, 10);
  assert.ok(requests.some(r => r.addBanding));
  assert.ok(requests.some(r => r.setDataValidation));
  assert.ok(requests.some(r => r.updateDimensionProperties?.properties.hiddenByUser));
  assert.equal(requests.filter(r => r.repeatCell?.cell.userEnteredFormat.numberFormat).length, 2);
  assert.equal(requests.filter(r => r.setDataValidation?.rule?.condition.type === "DATE_IS_VALID").length, 0);
  assert.equal(M.richColumns(0).filter(r => r.setDataValidation && !r.setDataValidation.rule).map(r => r.setDataValidation.range.startColumnIndex).join(","), "4,6");
  assert.equal(requests.filter(r => r.addConditionalFormatRule).length, 6);
});

test("an existing tracker upgrades its date columns when it reconnects", async () => {
  const b = connected({ clientId: "example.apps.googleusercontent.com" });
  b.rows.push(["Acme", "Engineer", entry.url, "Denver", "Applied", "Applied", "Saved", ""]);
  const result = await b.request("CONNECT", {}, admin);
  assert.equal(result.ok, true, result.error);
  assert.equal(b.local.avidTracker.connection.templateVersion, 3);
  const upgrade = b.calls.find(call => call.body?.requests?.some(request => request.setDataValidation && !request.setDataValidation.rule));
  assert.ok(upgrade);
  assert.equal(b.rows[1][4], "");
  assert.equal(b.rows[1][6], "");
});

test("the small prompt appears after confirmation without invoking autofill, and supports editable local saves", async () => {
  const dom = detector(postingHtml.replace('<h1>', '<div class="company-name">Acme</div><h1>'));
  const b = backend({ enabled: true });
  const onMessage = [];
  dom.window.chrome = { ...b.chrome, runtime: { sendMessage: msg => b.request(msg.type.replace("AVID_TRACKER_", ""), msg, { ...sender, url: dom.window.location.href }), onMessage: { addListener: fn => onMessage.push(fn) } } };
  dom.window.eval(read("src/content/tracker.js"));
  await new Promise(resolve => setTimeout(resolve, 60));
  let root = dom.window.document.querySelector("#avid-tracker-root").shadowRoot;
  assert.equal(root.querySelector(".card").hidden, true);
  dom.window.document.body.innerHTML = "<h1>Thank you for applying</h1>";
  await new Promise(resolve => setTimeout(resolve, 450));
  root = dom.window.document.querySelector("#avid-tracker-root").shadowRoot;
  assert.equal(root.querySelector(".card").hidden, false);
  assert.equal(root.querySelector('[name="company"]').value, "Acme");
  assert.equal(root.querySelector('[name="role"]').value, "Software Engineer");
  assert.equal(root.querySelector('[name="status"]').value, "Applied");
  assert.equal(root.querySelector('[name="applied"]').value, dom.window.AvidAutofill.trackerModel.today());
  assert.equal(root.querySelector('[name="followUp"]').value, dom.window.AvidAutofill.trackerModel.daysFromToday(7));
  assert.equal(dom.window.AvidAutofill.engine, undefined);
  root.querySelector('[name="company"]').value = "Corrected company";
  root.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(b.local.avidTracker.entries[0].entry.company, "Corrected company");
  assert.match(root.querySelector(".message").textContent, /Not synced yet/);
  assert.equal(b.calls.length, 0);
  dom.window.close();
});

test("the manual tracker sidebar shows both date defaults", async () => {
  const dom = detector();
  const b = backend();
  dom.window.chrome = { ...b.chrome, runtime: { sendMessage: msg => b.request(msg.type.replace("AVID_TRACKER_", ""), msg, { ...sender, url: dom.window.location.href }), onMessage: { addListener() {} } } };
  dom.window.eval(read("src/content/tracker.js"));
  await new Promise(resolve => setTimeout(resolve, 60));
  await dom.window.AvidAutofill.tracker.open();
  const root = dom.window.document.querySelector("#avid-tracker-root").shadowRoot;
  assert.equal(root.querySelector('[name="applied"]').value, dom.window.AvidAutofill.trackerModel.today());
  assert.equal(root.querySelector('[name="followUp"]').value, dom.window.AvidAutofill.trackerModel.daysFromToday(7));
  dom.window.close();
});
