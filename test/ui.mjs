import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function chromeShim(sendMessage = () => {}, addListener = () => {}) {
  const store = {};
  return {
    runtime: {
      getManifest: () => ({}),
      openOptionsPage: () => {},
      sendMessage,
      onMessage: { addListener },
    },
    storage: {
      local: {
        async get(key) { return { [key]: store[key] }; },
        async set(values) { Object.assign(store, values); },
        async remove(key) { delete store[key]; },
      },
    },
  };
}

function loadOptions() {
  const html = fs.readFileSync(path.join(ROOT, "src/options/options.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.chrome = chromeShim();
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/shared/schema.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/options/options.js"), "utf8"));
  return dom;
}

test("My Info keeps the field hosts separate from section cards", async () => {
  const dom = loadOptions();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { document } = dom.window;

  assert.equal(document.querySelector("#personal-section h2").textContent, "Personal");
  assert.equal(document.querySelectorAll("#personal [data-path]").length, 13);
  assert.equal(document.querySelectorAll("#links [data-path]").length, 5);
  assert.equal(document.querySelectorAll("#workAuth [data-path]").length, 2);
  assert.equal(document.querySelectorAll("#questions [data-path]").length, 7);
  assert.equal(document.querySelectorAll("#eeo [data-path]").length, 5);
  dom.window.close();
});

test("page drawer keeps keyboard focus when it opens and collapses", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.chrome = chromeShim();
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/shared/schema.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/content/widget.js"), "utf8"));
  const A = dom.window.AvidAutofill;
  A.widget.mount({ name: "Greenhouse" });

  const shadow = dom.window.document.querySelector("#avid-autofill-root").shadowRoot;
  const panel = shadow.querySelector(".panel");
  const launcher = shadow.querySelector(".launcher");
  const editProfile = shadow.querySelector(".opt");
  assert.equal(panel.hidden, false);
  assert.equal(launcher.hidden, true);
  assert.equal(editProfile.tagName, "BUTTON");
  assert.equal(editProfile.type, "button");
  assert.equal(shadow.querySelector(".status").textContent, "");
  assert.equal(shadow.querySelector(".intro h1").textContent, "Ready to fill your application");

  const collapse = shadow.querySelector(".collapse");
  collapse.focus();
  collapse.click();
  assert.equal(panel.hidden, true);
  assert.equal(launcher.hidden, false);
  assert.equal(shadow.activeElement, launcher);

  launcher.focus();
  launcher.click();
  assert.equal(panel.hidden, false);
  assert.equal(launcher.hidden, true);
  assert.equal(shadow.activeElement, collapse);

  collapse.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(panel.hidden, true);
  assert.equal(launcher.hidden, false);
  assert.equal(shadow.activeElement, launcher);
  dom.window.close();
});

test("Copy info shows every saved section and copies full work descriptions", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    dom.window.chrome = chromeShim();
    dom.window.eval(fs.readFileSync(path.join(ROOT, "src/shared/schema.js"), "utf8"));
    dom.window.eval(fs.readFileSync(path.join(ROOT, "src/content/widget.js"), "utf8"));
    const A = dom.window.AvidAutofill;
    const profile = await A.getProfile();
    const description = "Built the search page.\nReduced load time by 40%.";
    profile.personal.fullName = "Ada Example";
    profile.links.portfolio = "https://example.com/work";
    profile.work = [{ title: "Engineer", company: "Acme", description, current: true }];
    profile.education = [{ school: "Example University", degree: "BS" }];
    profile.misc.customAnswers = { "Why this role?": "I like building search." };
    profile.eeo.gender = "Prefer not to say";
    await A.saveProfile(profile);
    const copied = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { copied.push(value); } },
    });
    A.widget.mount({ name: "Greenhouse" });
    const panel = dom.window.document.querySelector("#avid-autofill-root").shadowRoot.querySelector(".panel");
    panel.querySelector(".copy-tab").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(panel.querySelector(".fill-view").hidden, true);
    assert.equal(panel.querySelector(".copy-view").hidden, false);
    for (const value of ["Ada Example", "https://example.com/work", description, "Example University", "I like building search.", "Prefer not to say"]) {
      assert.ok([...panel.querySelectorAll(".copy-field p")].some((node) => node.textContent === value), value);
    }
    const workGroup = [...panel.querySelectorAll(".copy-group")].find((node) => node.querySelector("h2")?.textContent === "Experience");
    assert.equal(workGroup.querySelector("h3").textContent, "Engineer at Acme");
    const descriptionField = [...workGroup.querySelectorAll(".copy-field")].find((node) => node.querySelector("b").textContent === "Description");
    descriptionField.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(copied, [description]);
    assert.equal(panel.querySelector(".copy-status").textContent, "Copied Description");

    Object.defineProperty(dom.window.navigator, "clipboard", { value: undefined });
    dom.window.document.execCommand = (command) => {
      assert.equal(command, "copy");
      copied.push(dom.window.document.querySelector("#avid-autofill-root").shadowRoot.querySelector("textarea").value);
      return true;
    };
    descriptionField.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(copied, [description, description]);
  } finally { dom.window.close(); }
});

test("page drawer survives ATS hydration replacing the body and removing its host", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.chrome = chromeShim();
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/shared/schema.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/content/widget.js"), "utf8"));
  dom.window.AvidAutofill.widget.mount({ name: "Greenhouse" });

  dom.window.document.body.replaceWith(dom.window.document.createElement("body"));
  assert.ok(dom.window.document.querySelector("#avid-autofill-root"));

  dom.window.document.querySelector("#avid-autofill-root").remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(dom.window.document.querySelector("#avid-autofill-root"));
  dom.window.close();
});

test("an empty autofill result never says ready to submit", async () => {
  const dom = new JSDOM("<body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    dom.window.chrome = chromeShim();
    for (const file of ["src/shared/schema.js", "src/content/widget.js"]) {
      dom.window.eval(fs.readFileSync(path.join(ROOT, file), "utf8"));
    }
    const A = dom.window.AvidAutofill;
    A.getProfile = async () => ({ personal: { email: "test@example.com" } });
    A.engine = { fillPage: async () => ({ ats: "Generic", filledCount: 0, results: [] }) };
    A.widget.mount({ name: "Generic" });
    const root = dom.window.document.getElementById("avid-autofill-root").shadowRoot;
    root.querySelector(".fill").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(root.querySelector(".status").textContent, "No matching fields");
    assert.match(root.querySelector(".summary").textContent, /Nothing was filled/);
  } finally { dom.window.close(); }
});

test("drawer recovers after the page replaces its document element", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    dom.window.chrome = chromeShim();
    for (const file of ["src/shared/schema.js", "src/content/widget.js"]) {
      dom.window.eval(fs.readFileSync(path.join(ROOT, file), "utf8"));
    }
    const { document, AvidAutofill: A } = dom.window;
    A.widget.mount({ name: "Greenhouse" });
    const host = document.getElementById("avid-autofill-root");
    document.documentElement.replaceWith(document.createElement("html"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(host.isConnected, true, "drawer should remain on the page after replacement");

    host.shadowRoot.querySelector(".collapse").click();
    host.remove();
    assert.equal(A.widget.open(), true);
    assert.equal(host.isConnected, true, "toolbar open should reattach the drawer immediately");
    assert.equal(host.shadowRoot.querySelector(".panel").hidden, false);
  } finally {
    dom.window.close();
  }
});

test("reinjection preserves the mounted drawer's open handler", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  try {
    dom.window.chrome = chromeShim();
    dom.window.eval(fs.readFileSync(path.join(ROOT, "src/shared/schema.js"), "utf8"));
    const widget = fs.readFileSync(path.join(ROOT, "src/content/widget.js"), "utf8");
    dom.window.eval(widget);
    dom.window.AvidAutofill.widget.mount({ name: "Greenhouse" });
    const host = dom.window.document.getElementById("avid-autofill-root");
    host.shadowRoot.querySelector(".collapse").click();
    dom.window.eval(widget);
    assert.equal(dom.window.AvidAutofill.widget.open(), true);
    assert.equal(host.shadowRoot.querySelector(".panel").hidden, false);
    assert.equal(dom.window.document.querySelectorAll("#avid-autofill-root").length, 1);
  } finally {
    dom.window.close();
  }
});

test("SmartRecruiters mounts a named drawer on a current application URL", () => {
  const dom = new JSDOM("<!doctype html><body><form></form></body>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://jobs.smartrecruiters.com/oneclick-ui/company/example/publication/example",
  });
  dom.window.chrome = chromeShim();
  for (const file of ["src/shared/schema.js", "src/content/adapters.js", "src/content/widget.js"]) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }

  const A = dom.window.AvidAutofill;
  const adapter = A.adapters.detect();
  A.widget.mount(adapter);

  const shadow = dom.window.document.querySelector("#avid-autofill-root").shadowRoot;
  assert.equal(adapter.name, "SmartRecruiters");
  assert.equal(shadow.querySelector(".eyebrow").textContent, "SmartRecruiters");
  assert.equal(shadow.querySelector(".status").textContent, "");
  dom.window.close();
});

test("iCIMS keeps one outer drawer and delegates filling to its candidate iframe", async () => {
  const report = { ats: "iCIMS", stub: true, filledCount: 1, results: [] };
  const sent = [];
  let candidateListener;
  const dom = new JSDOM('<form id="job-search"></form><iframe id="icims_content_iframe"></iframe>', {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://career-schwab.icims.com/jobs/126227/example/candidate",
  });
  const loadFrame = (win, sendMessage, addListener, frameWindow = win) => {
    win.chrome = chromeShim(sendMessage, addListener);
    win.requestIdleCallback = (callback) => callback();
    for (const file of ["src/shared/schema.js", "src/content/adapters.js", "src/content/widget.js"]) {
      win.eval(fs.readFileSync(path.join(ROOT, file), "utf8"));
    }
    win.AvidAutofill.adapters.detect = () => ({ name: "iCIMS", stub: true, customSelectSelectors: [] });
    win.AvidAutofill.engine = { fillPage: async () => report };
    const main = fs.readFileSync(path.join(ROOT, "src/content/main.js"), "utf8");
    win.Function("window", "document", "globalThis", "chrome", main)(
      frameWindow,
      win.document,
      win,
      win.chrome
    );
  };

  const candidate = dom.window.document.querySelector("iframe").contentWindow;
  candidate.document.body.innerHTML = '<form id="candidate"><input type="email"></form>';
  const liveIcimsWindow = { parent: dom.window, requestIdleCallback: candidate.requestIdleCallback };
  liveIcimsWindow.top = liveIcimsWindow;
  loadFrame(candidate, undefined, (listener) => { candidateListener = listener; }, liveIcimsWindow);
  loadFrame(dom.window, async (message) => {
    sent.push(message);
    return new Promise((resolve) => {
      assert.equal(candidateListener(message, {}, resolve), true);
    });
  });

  assert.ok(dom.window.document.querySelector("#avid-autofill-root"));
  assert.equal(candidate.document.querySelector("#avid-autofill-root"), null);
  assert.deepEqual(await dom.window.AvidAutofill.engine.fillPage(), report);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "AVID_FILL_ICIMS_FRAME");
  dom.window.close();
});

test("service worker relays an outer iCIMS fill request to the tab frames", async () => {
  let listener;
  const forwarded = [];
  const report = { ats: "iCIMS", filledCount: 1, results: [] };
  const chrome = {
    action: { onClicked: { addListener: () => {} } },
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (value) => { listener = value; } },
      openOptionsPage: () => {},
    },
    tabs: {
      async sendMessage(tabId, message) {
        forwarded.push({ tabId, type: message.type });
        return { ok: true, report };
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, "src/background/service-worker.js"), "utf8"),
    { chrome, console, importScripts: () => {} }
  );

  const response = await new Promise((resolve) => {
    const keepChannelOpen = listener(
      { type: "AVID_FILL_ICIMS_FRAME" },
      { tab: { id: 42 }, frameId: 0 },
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
  assert.deepEqual(forwarded, [{ tabId: 42, type: "AVID_FILL_ICIMS_FRAME" }]);
  assert.equal(response.ok, true);
  assert.equal(response.report.filledCount, 1);
  assert.equal(
    listener({ type: "AVID_FILL_ICIMS_FRAME" }, { tab: { id: 42 }, frameId: 3 }, () => {}),
    undefined
  );
  assert.equal(forwarded.length, 1);
});
