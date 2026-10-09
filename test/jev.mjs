import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const admin = { id: "avid-test", url: "chrome-extension://avid-test/src/options/options.html" };
const content = { id: "avid-test", tab: { id: 7 }, frameId: 0, url: "https://jobs.ashbyhq.com/acme/application" };
function reply(request, choices = {}) {
  return { model: request.model, usage: { input_tokens: 100, output_tokens: 20 }, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    const choice = choices[id] || Object.keys(question.criteria)[0], keys = Object.keys(question.criteria);
    return [id, { type: "choice", choice, confidence: .97, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? .98 : .02 / (keys.length - 1)])) }];
  })) };
}
function worker(fetcher = async (_, init) => ({ ok: true, json: async () => reply(JSON.parse(init.body)) })) {
  const local = {}, session = {}, calls = [];
  let listener, permission = true, accessLevel;
  const area = store => ({ async get(key) { return clone({ [key]: store[key] }); }, async set(values) { Object.assign(store, clone(values)); }, async remove(key) { delete store[key]; } });
  const chrome = {
    storage: { local: area(local), session: { ...area(session), async setAccessLevel(value) { accessLevel = value.accessLevel; } } },
    permissions: { async contains() { return permission; } },
    runtime: { id: "avid-test", getURL: path => `chrome-extension://avid-test/${path}`, onMessage: { addListener(fn) { listener = fn; } } },
  };
  const context = vm.createContext({ chrome, URL, TextEncoder, AbortController, setTimeout, clearTimeout, fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init); } });
  for (const file of ["src/shared/schema.js", "src/shared/jev.js", "src/background/jev.js"]) vm.runInContext(read(file), context);
  const A = context.AvidAutofill;
  const send = (message, sender = admin) => new Promise(resolve => listener(message, sender, resolve));
  return { A, local, session, calls, send, set permission(value) { permission = value; }, get accessLevel() { return accessLevel; } };
}
async function connected(fetcher) {
  const w = worker(fetcher), profile = clone(w.A.DEFAULT_PROFILE);
  profile.personal.preferredName = "Alex";
  profile.questionBank = [{ id: "weekends", question: "Are you available on weekends?", answer: "No", approved: true, anySite: false, scopeUrl: "https://jobs.ashbyhq.com/acme/" }];
  await w.A.saveProfile(profile);
  const saved = await w.send({ type: "AVID_JEV_SAVE", enabled: true, key: "synthetic-test-key" });
  assert.equal(saved.ok, true);
  return w;
}
const field = { id: "f0", label: "What should we call you?", type: "text" };

test("Jev is off by default and cannot call the provider", async () => {
  const w = worker();
  const result = await w.send({ type: "AVID_JEV_FILL", fields: [field] }, content);
  assert.equal(result.ok, false); assert.match(result.error, /off/); assert.equal(w.calls.length, 0);
});
test("key stays in trusted session storage and configuration accepts only My Info", async () => {
  const w = await connected();
  assert.equal(w.accessLevel, "TRUSTED_CONTEXTS");
  assert.equal(w.session.avidJevKey, "synthetic-test-key");
  assert.equal(JSON.stringify(w.local).includes("synthetic-test-key"), false);
  const state = await w.send({ type: "AVID_JEV_STATE" });
  assert.equal(state.hasKey, true); assert.equal(JSON.stringify(state).includes("synthetic-test-key"), false);
  assert.equal((await w.send({ type: "AVID_JEV_CLEAR" }, content)).ok, false);
  assert.equal((await w.send({ type: "AVID_JEV_SAVE", enabled: true, key: "stolen" }, content)).ok, false);
  assert.equal((await w.send({ type: "AVID_JEV_FILL", fields: [field] }, { ...content, id: "other" })).ok, false);
});
test("source request sends labels and descriptions, resolves values locally, and uses a fixed endpoint", async () => {
  const w = await connected();
  const result = await w.send({ type: "AVID_JEV_FILL", fields: [{ ...field, value: "page-secret", extra: "ignored" }] }, content);
  assert.equal(result.ok, true); assert.equal(result.results[0].value, "Alex");
  assert.equal(w.calls.length, 1);
  const { url, init } = w.calls[0];
  assert.equal(url, "https://api.typesafe.ai/v1/systemone"); assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer synthetic-test-key"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
  assert.equal(init.body.includes("Alex"), false); assert.equal(init.body.includes("page-secret"), false);
  const request = JSON.parse(init.body);
  assert.equal(request.model, "jev-1.13.0"); assert.match(request.questions.answer_f0.instructions, /state.fields.f0/);
  assert.ok(request.questions.answer_f0.criteria.NEEDS_USER);
});
test("question-bank scope uses the trusted sender URL and respects path boundaries", async () => {
  const w = await connected(), J = w.A.jev;
  assert.ok(J.sourcesFor(await w.A.getProfile(), content.url).bank_weekends);
  for (const url of ["https://jobs.ashbyhq.com/other/application", "https://jobs.ashbyhq.com/acme2/application", "https://example.test/acme/"]) assert.equal(J.sourcesFor(await w.A.getProfile(), url).bank_weekends, undefined);
  await w.send({ type: "AVID_JEV_FILL", fields: [field], url: content.url }, { ...content, url: "https://jobs.ashbyhq.com/other/" });
  assert.equal(JSON.parse(w.calls[0].init.body).questions.answer_f0.criteria.bank_weekends, undefined);
  const p = await w.A.getProfile(); p.questionBank[0].approved = false;
  assert.equal(J.sourcesFor(p, content.url).bank_weekends, undefined);
  assert.equal(J.sourcesFor(p, content.url).workAuth_requireSponsorship, undefined);
});
test("native choices require a second validated request carrying only the selected fact", async () => {
  let stage = 0;
  const w = await connected(async (_, init) => {
    const request = JSON.parse(init.body);
    return { ok: true, json: async () => reply(request, { answer_f0: stage++ === 0 ? "bank_weekends" : "o1" }) };
  });
  const result = await w.send({ type: "AVID_JEV_FILL", fields: [{ id: "f0", label: "Are you unavailable on weekends?", type: "select", options: { o1: "Yes", o2: "No" } }] }, content);
  assert.equal(result.ok, true); assert.equal(result.results[0].value, "No"); assert.equal(result.results[0].optionId, "o1");
  const second = JSON.parse(w.calls[1].init.body);
  assert.equal(second.state.fields.f0.approved_fact.answer, "No");
  assert.equal(w.calls[1].init.body.includes("Alex"), false);
  assert.deepEqual(Object.keys(second.questions.answer_f0.criteria), ["o1", "o2", "NEEDS_USER"]);
});
test("invalid option-stage replies reject the entire AI batch", async () => {
  let stage = 0;
  const w = await connected(async (_, init) => {
    const request = JSON.parse(init.body), response = reply(request, { answer_f0: stage++ === 0 ? "bank_weekends" : "invented-option" });
    return { ok: true, json: async () => response };
  });
  const result = await w.send({ type: "AVID_JEV_FILL", fields: [{ ...field, type: "select", options: { o1: "Yes", o2: "No" } }] }, content);
  assert.equal(result.ok, false); assert.equal(result.results, undefined);
});
test("profile changes and disconnecting while waiting discard pending results", async () => {
  for (const change of [async w => { const p = await w.A.getProfile(); p.personal.preferredName = "Changed"; await w.A.saveProfile(p); }, async w => { await w.send({ type: "AVID_JEV_CLEAR" }); }, async w => { w.permission = false; }]) {
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const w = await connected(async (_, init) => { started(); await new Promise(resolve => { release = resolve; }); return { ok: true, json: async () => reply(JSON.parse(init.body)) }; });
    const pending = w.send({ type: "AVID_JEV_FILL", fields: [field] }, content);
    await ready; await change(w); release();
    assert.equal((await pending).ok, false);
  }
});
for (const [name, mutate] of [
  ["unknown choice", r => { r.answers.answer_f0.choice = "invented"; }],
  ["missing question", r => { delete r.answers.answer_f0; }],
  ["extra question", r => { r.answers.extra = r.answers.answer_f0; }],
  ["wrong model", r => { r.model = "other"; }],
  ["wrong type", r => { r.answers.answer_f0.type = "noul"; }],
  ["missing probability", r => { delete r.answers.answer_f0.probabilities.NEEDS_USER; }],
  ["invalid probability", r => { r.answers.answer_f0.probabilities.personal_preferredName = NaN; }],
  ["wrong probability sum", r => { r.answers.answer_f0.probabilities.personal_preferredName = .7; }],
  ["wrong winning choice", r => { r.answers.answer_f0.choice = "NEEDS_USER"; }],
  ["invalid confidence", r => { r.answers.answer_f0.confidence = 2; }],
  ["invalid usage", r => { r.usage.input_tokens = -1; }],
]) test(`contract rejects ${name}`, () => {
  const w = worker(), J = w.A.jev, request = J.requestFor([field], { personal_preferredName: { description: "Preferred name", value: "Alex" } });
  const response = reply(request); mutate(response);
  assert.throws(() => J.validate(request, response), /invalid response/);
});
test("uncertain responses and missing keys leave answers for manual review", async () => {
  const w = await connected(async (_, init) => {
    const response = reply(JSON.parse(init.body));
    response.answers.answer_f0.probabilities = { personal_preferredName: .6, bank_weekends: .2, NEEDS_USER: .2 };
    return { ok: true, json: async () => response };
  });
  assert.equal((await w.send({ type: "AVID_JEV_FILL", fields: [field] }, content)).results[0].status, "ai-needs-answer");
  delete w.session.avidJevKey;
  assert.match((await w.send({ type: "AVID_JEV_FILL", fields: [field] }, content)).error, /browser session/);
});
for (const status of [401, 422, 429, 529]) test(`HTTP ${status} returns a useful error without provider details or keys`, async () => {
  const w = await connected(async () => ({ ok: false, status, json: async () => ({ error: "synthetic-test-key" }) }));
  const result = await w.send({ type: "AVID_JEV_FILL", fields: [field] }, content);
  assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("synthetic-test-key"), false);
});
test("field validation rejects unknown types and excessive batches without calling Jev", async () => {
  const w = await connected();
  for (const fields of [[{ ...field, type: "password" }], Array.from({ length: 21 }, (_, i) => ({ ...field, id: `f${i}` }))]) assert.equal((await w.send({ type: "AVID_JEV_FILL", fields }, content)).ok, false);
  assert.equal(w.calls.length, 0);
});

async function page(html, sendMessage, existingWorker) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: content.url });
  const w = existingWorker || worker();
  dom.window.chrome = { storage: { local: { get: async key => clone({ [key]: w.local[key] }), set: async values => Object.assign(w.local, clone(values)) } }, runtime: { sendMessage } };
  for (const file of ["src/shared/schema.js", "src/content/fillers.js", "src/content/matcher.js", "src/content/adapters.js", "src/content/workday.js", "src/content/jev.js", "src/content/engine.js"]) dom.window.eval(read(file));
  const A = dom.window.AvidAutofill;
  A.fillers.sleep = async () => {};
  for (const el of dom.window.document.querySelectorAll("input,textarea,select")) el.getClientRects = () => [{}];
  const profile = clone(A.DEFAULT_PROFILE); profile.personal.preferredName = "Alex"; profile.personal.email = "alex@example.test";
  const settings = { ...clone(A.DEFAULT_SETTINGS), jevEnabled: true };
  await A.saveProfile(profile); await A.saveSettings(settings);
  return { dom, A, profile, settings, close: () => dom.window.close() };
}
const textForm = '<form><div><label for="alias">What should we call you?</label><input id="alias"></div><div><label for="email">Email</label><input id="email" type="email"></div></form>';
test("fill engine retains rule fills and fills only unmatched approved AI answers", async () => {
  const p = await page(textForm, async msg => {
    assert.equal(msg.type, "AVID_JEV_FILL"); assert.equal(msg.fields.length, 1);
    return { ok: true, results: [{ id: msg.fields[0].id, status: "fill", value: "Alex", sourceQuestion: "Preferred name" }] };
  });
  try {
    const report = await p.A.engine.fillPage(p.profile, p.settings, null);
    assert.equal(p.dom.window.document.getElementById("alias").value, "Alex");
    assert.equal(p.dom.window.document.getElementById("email").value, "alex@example.test");
    assert.equal(report.filledCount, 2); assert.match(report.aiMessage, /1 extra field/);
    assert.equal(report.results.find(r => r.method === "jev").reason, "Preferred name");
  } finally { p.close(); }
});
test("engine keeps user input entered during a pending reply", async () => {
  let p;
  p = await page(textForm, async msg => {
    p.dom.window.document.getElementById("alias").value = "My own answer";
    return { ok: true, results: [{ id: msg.fields[0].id, status: "fill", value: "Alex" }] };
  });
  try {
    const report = await p.A.engine.fillPage(p.profile, p.settings, null);
    assert.equal(p.dom.window.document.getElementById("alias").value, "My own answer");
    assert.ok(report.results.some(r => r.status === "kept-existing"));
  } finally { p.close(); }
});
test("complete engine-worker flow validates both provider stages before filling", async () => {
  const w = await connected(async (_, init) => {
    const request = JSON.parse(init.body), choices = {};
    for (const [id, field] of Object.entries(request.state.fields)) choices[`answer_${id}`] = field.approved_fact ? "o1" : field.type === "select" ? "bank_weekends" : "personal_preferredName";
    return { ok: true, json: async () => reply(request, choices) };
  });
  const p = await page(textForm.replace("</form>", '<div><label for="weekend">Are you unavailable on weekends?</label><select id="weekend"><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select></div></form>'), msg => w.send(msg, content), w);
  try {
    p.profile.questionBank = [{ id: "weekends", question: "Are you available on weekends?", answer: "No", approved: true, anySite: false, scopeUrl: "https://jobs.ashbyhq.com/acme/" }];
    await p.A.saveProfile(p.profile);
    const report = await p.A.engine.fillPage(p.profile, p.settings, null);
    assert.equal(report.filledCount, 3);
    assert.equal(p.dom.window.document.getElementById("alias").value, "Alex");
    assert.equal(p.dom.window.document.getElementById("weekend").value, "yes");
    assert.equal(w.calls.length, 2);
    assert.equal(w.calls[0].init.body.includes("Alex"), false);
    assert.match(report.aiMessage, /2 extra fields/);
  } finally { p.close(); }
});
test("malformed internal replies preserve rule fills and never reach AI setters", async () => {
  const p = await page(textForm, async () => ({ ok: true, results: [null] }));
  try {
    const report = await p.A.engine.fillPage(p.profile, p.settings, null);
    assert.equal(p.dom.window.document.getElementById("alias").value, "");
    assert.equal(p.dom.window.document.getElementById("email").value, "alex@example.test");
    assert.ok(report.results.some(r => r.status === "ai-unavailable"));
  } finally { p.close(); }
});
test("engine discards replies after URL, label, or control-constraint changes", async () => {
  for (const change of [p => p.dom.window.history.pushState({}, "", "/other"), p => { p.dom.window.document.querySelector('label[for="alias"]').textContent = "Different question"; }, p => { p.dom.window.document.getElementById("alias").maxLength = 1; }]) {
    let p;
    p = await page(textForm, async msg => { change(p); return { ok: true, results: [{ id: msg.fields[0].id, status: "fill", value: "Alex" }] }; });
    try {
      const report = await p.A.engine.fillPage(p.profile, p.settings, null);
      assert.equal(p.dom.window.document.getElementById("alias").value, "");
      assert.ok(report.results.some(r => r.status === "ai-stale"));
    } finally { p.close(); }
  }
});
test("AI preserves rule fills on provider errors and rejects incompatible values", async () => {
  for (const response of [{ ok: false, error: "Jev is busy" }, { ok: true, results: [{ id: "f0", status: "fill", value: "too long" }] }]) {
    const p = await page(textForm, async () => response);
    try {
      p.dom.window.document.getElementById("alias").maxLength = 4;
      const report = await p.A.engine.fillPage(p.profile, p.settings, null);
      assert.equal(p.dom.window.document.getElementById("alias").value, "");
      assert.equal(p.dom.window.document.getElementById("email").value, "alex@example.test");
      assert.ok(report.results.some(r => ["ai-unavailable", "ai-incompatible"].includes(r.status)));
    } finally { p.close(); }
  }
});
test("native option IDs map exactly and changed underlying values are rejected", async () => {
  for (const changed of [false, true]) {
    let p;
    p = await page('<form><label for="weekend">Are you unavailable on weekends?</label><select id="weekend"><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select></form>', async msg => {
      if (changed) p.dom.window.document.getElementById("weekend").options[1].value = "changed";
      return { ok: true, results: [{ id: msg.fields[0].id, status: "fill", value: "No", optionId: "o1" }] };
    });
    try {
      await p.A.engine.fillPage(p.profile, p.settings, null);
      assert.equal(p.dom.window.document.getElementById("weekend").value, changed ? "" : "yes");
    } finally { p.close(); }
  }
});
test("radio choices use exact IDs and existing selections are preserved", async () => {
  const p = await page('<form><fieldset><legend>Are you unavailable on weekends?</legend><label>Yes<input type="radio" name="weekend" value="yes"></label><label>No<input type="radio" name="weekend" value="no"></label></fieldset></form>', async msg => ({ ok: true, results: [{ id: msg.fields[0].id, status: "fill", value: "No", optionId: "o0" }] }));
  try {
    await p.A.engine.fillPage(p.profile, p.settings, null);
    assert.equal(p.dom.window.document.querySelector('input[value="yes"]').checked, true);
    p.dom.window.chrome.runtime.sendMessage = () => { throw new Error("Should not call again"); };
    await p.A.engine.fillPage(p.profile, p.settings, null);
    assert.equal(p.dom.window.document.querySelector('input[value="yes"]').checked, true);
  } finally { p.close(); }
});
test("off mode and sensitive, legal, or custom controls never call Jev", async () => {
  const p = await page('<form><div><label for="self">Your gender identity</label><input id="self"></div><input type="password" aria-label="Password"><input type="checkbox" aria-label="Agree to terms"><input role="combobox" aria-label="Anything else"><input type="text" aria-label="Search"></form>', () => { throw new Error("Unexpected Jev call"); });
  try {
    const report = await p.A.engine.fillPage(p.profile, p.settings, null);
    assert.equal(report.aiMessage, "");
    const q = await page(textForm, () => { throw new Error("Unexpected Jev call"); });
    try { q.settings.jevEnabled = false; assert.equal((await q.A.engine.fillPage(q.profile, q.settings, null)).aiMessage, ""); } finally { q.close(); }
  } finally { p.close(); }
});

test("My Info saves approved scoped bank entries and exports no Jev key", async () => {
  const dom = new JSDOM(read("src/options/options.html"), { runScripts: "outside-only", pretendToBeVisual: true, url: admin.url });
  const local = {};
  dom.window.chrome = { storage: { local: { async get(key) { return { [key]: local[key] }; }, async set(values) { Object.assign(local, clone(values)); } } } };
  for (const file of ["src/shared/schema.js", "src/shared/jev.js", "src/options/options.js"]) dom.window.eval(read(file));
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    const doc = dom.window.document;
    doc.querySelector('[data-add="questionBank"]').click();
    doc.getElementById("questionBank[0].question").value = "Describe your proudest project";
    doc.getElementById("questionBank[0].answer").value = "Built a test project.";
    doc.getElementById("save").click();
    assert.match(doc.getElementById("save-msg").textContent, /URL prefix/);
    assert.equal(local.avidProfile, undefined);
    doc.getElementById("questionBank[0].scopeUrl").value = "https://jobs.ashbyhq.com/acme/";
    doc.getElementById("save").click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(local.avidProfile.questionBank[0].approved, true);
    doc.getElementById("jev-key").value = "synthetic-test-key";
    let exported;
    dom.window.URL.createObjectURL = blob => { exported = blob; return "blob:export"; };
    dom.window.HTMLAnchorElement.prototype.click = () => {};
    doc.getElementById("export").click();
    const data = await new Promise(resolve => { const reader = new dom.window.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(exported); });
    assert.equal(data.includes("synthetic-test-key"), false);
    assert.ok(JSON.parse(data).questionBank.length);
  } finally { dom.window.close(); }
});

test("live evaluation cases have a consistent oracle and grading", () => {
  const context = vm.createContext({ URL, TextEncoder });
  for (const file of ["src/shared/jev.js", "test/live/jev-cases.js", "test/live/jev-eval.js"]) vm.runInContext(read(file), context);
  const J = context.AvidAutofill.jev, grade = context.JEV_GRADE, ids = new Set();
  for (const c of context.JEV_CASES) {
    assert.ok(!ids.has(c.id), `duplicate case ${c.id}`); ids.add(c.id);
    const sources = J.sourcesFor(context.JEV_PROFILE, c.pageUrl);
    J.cleanFields(c.fields);
    for (const field of c.fields) {
      if (field.expect === null) continue;
      if (field.expect.option) assert.ok(Object.hasOwn(field.options, field.expect.option), `${c.id}/${field.id} expects a missing option`);
      else for (const id of [].concat(field.expect)) assert.ok(Object.hasOwn(sources, id), `${c.id}/${field.id} expects unavailable source ${id}`);
    }
  }
  assert.ok(!Object.hasOwn(J.sourcesFor(context.JEV_PROFILE, "https://jobs.lever.co/globex/x"), "bank_why_acme"));
  assert.ok(!Object.hasOwn(J.sourcesFor(context.JEV_PROFILE, "https://boards.greenhouse.io/acme/x"), "bank_noncompete"));
  assert.equal(grade({ expect: null }, { status: "ai-needs-answer" }), "correct-abstain");
  assert.equal(grade({ expect: null }, { status: "fill", sourceId: "bank_salary" }), "wrong-fill");
  assert.equal(grade({ expect: "bank_salary" }, { status: "ai-needs-answer" }), "missed");
  assert.equal(grade({ expect: "bank_salary" }, { status: "fill", sourceId: "bank_notice" }), "wrong-fill");
  assert.equal(grade({ expect: ["bank_start", "bank_notice"] }, { status: "fill", sourceId: "bank_notice" }), "correct");
  assert.equal(grade({ expect: { option: "o2" } }, { status: "fill", sourceId: "bank_sponsor", optionId: "o2" }), "correct");
  assert.equal(grade({ expect: { option: "o2" } }, { status: "fill", sourceId: "bank_sponsor", optionId: "o1" }), "wrong-fill");
});
