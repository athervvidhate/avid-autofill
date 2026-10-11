import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const click = (dom, id) => { dom.window.document.getElementById(id).click(); return tick().then(tick); };

function open(store = {}, handlers = {}) {
  const sent = [];
  const dom = new JSDOM(read("src/entrypoints/onboarding/index.html").replace(/<script[^>]*><\/script>/, ""), { runScripts: "outside-only", pretendToBeVisual: true, url: "chrome-extension://avid-test/onboarding.html" });
  dom.window.chrome = {
    runtime: {
      id: "avid-test", getURL: path => `chrome-extension://avid-test/${path}`,
      async sendMessage(message) { sent.push(message); const handler = handlers[message.type]; return handler ? handler(message) : { ok: true }; },
    },
    storage: { local: { async get(key) { return { [key]: store[key] }; }, async set(values) { Object.assign(store, JSON.parse(JSON.stringify(values))); }, async remove(key) { delete store[key]; } } },
    permissions: { async request() { return true; } },
    tabs: { create() {} },
  };
  for (const file of ["src/shared/schema.js", "src/shared/jev.js", "src/onboarding/onboarding.js"]) dom.window.eval(read(file));
  return tick().then(tick).then(() => ({ dom, store, sent, doc: dom.window.document }));
}
const visible = doc => [...doc.querySelectorAll("[data-step]")].filter(s => !s.hidden).map(s => s.dataset.step);

test("steps are skippable and progress resumes after the page closes", async () => {
  const { dom, store, doc } = await open({}, { AVID_TRACKER_STATE: () => ({ ok: true, configured: true }), AVID_JEV_STATE: () => ({ ok: true }) });
  assert.deepEqual(visible(doc), ["welcome"]);
  await click(dom, "ob-next");
  assert.deepEqual(visible(doc), ["google"]);
  await click(dom, "ob-skip");
  assert.deepEqual(visible(doc), ["jev"]);
  assert.equal(store.avidOnboarding.step, 2);
  assert.deepEqual(store.avidOnboarding.skipped, ["google"]);
  await click(dom, "ob-back");
  assert.deepEqual(visible(doc), ["google"]);
  dom.window.close();
  const again = await open(store, { AVID_TRACKER_STATE: () => ({ ok: true, configured: true }), AVID_JEV_STATE: () => ({ ok: true }) });
  assert.deepEqual(visible(again.doc), ["google"]);
  again.dom.window.close();
});

test("profile steps write to the same profile storage and keep existing data", async () => {
  const store = { avidProfile: { personal: { firstName: "Ada", city: "London" }, work: [{ title: "Engineer", company: "Acme" }] }, avidOnboarding: { step: 4, skipped: [] } };
  const { dom, doc } = await open(store);
  assert.deepEqual(visible(doc), ["contact"]);
  assert.equal(doc.getElementById("ob-personal-firstName").value, "Ada");
  doc.getElementById("ob-personal-lastName").value = "Lovelace";
  doc.getElementById("ob-links-github").value = "https://github.com/ada";
  await click(dom, "ob-next");
  assert.deepEqual(visible(doc), ["work"]);
  assert.equal(store.avidProfile.personal.lastName, "Lovelace");
  assert.equal(store.avidProfile.personal.city, "London");
  assert.equal(store.avidProfile.links.github, "https://github.com/ada");
  assert.equal(doc.getElementById("ob-work-0-company").value, "Acme");
  doc.getElementById("ob-work-0-company").value = "Analytical Engines";
  await click(dom, "ob-next");
  assert.deepEqual(store.avidProfile.work.map(w => w.company), ["Analytical Engines"]);
  // An untouched empty education card adds nothing.
  await click(dom, "ob-next");
  assert.deepEqual(store.avidProfile.education, []);
  dom.window.close();
});

test("connecting Google fills an empty email from the account", async () => {
  let connected = false;
  const { dom, store, doc } = await open({ avidOnboarding: { step: 1, skipped: [] } }, {
    AVID_TRACKER_STATE: () => ({ ok: true, configured: true, connected, email: connected ? "ada@example.com" : "" }),
    AVID_TRACKER_CONNECT: () => { connected = true; return { ok: true }; },
  });
  await click(dom, "ob-google-connect");
  assert.equal(doc.getElementById("ob-google-badge").textContent, "Connected");
  assert.equal(store.avidProfile.personal.email, "ada@example.com");
  dom.window.close();
});

test("Jev key is stored only after it checks out", async () => {
  let valid = false;
  const { dom, sent, doc } = await open({ avidOnboarding: { step: 2, skipped: [] } }, {
    AVID_JEV_STATE: () => ({ ok: true, enabled: false, hasKey: false }),
    AVID_JEV_VERIFY: () => ({ ok: true, valid }),
  });
  doc.getElementById("ob-jev-key").value = "bad-key";
  await click(dom, "ob-jev-save");
  assert.match(doc.getElementById("ob-jev-msg").textContent, /rejected/);
  assert.equal(sent.some(m => m.type === "AVID_JEV_SAVE"), false);
  valid = true;
  doc.getElementById("ob-jev-key").value = "good-key";
  await click(dom, "ob-jev-save");
  assert.deepEqual(JSON.parse(JSON.stringify(sent.find(m => m.type === "AVID_JEV_SAVE"))), { type: "AVID_JEV_SAVE", enabled: true, key: "good-key" });
  assert.equal(doc.getElementById("ob-jev-key").value, "");
  dom.window.close();
});
