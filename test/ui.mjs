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

test("page drawer opens, collapses, and reopens from its launcher", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.chrome = chromeShim();
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/shared/schema.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(ROOT, "src/content/widget.js"), "utf8"));
  const A = dom.window.AvidAutofill;
  A.widget.mount({ name: "Greenhouse" });

  const shadow = dom.window.document.querySelector("#avid-autofill-root").shadowRoot;
  const panel = shadow.querySelector(".panel");
  const launcher = shadow.querySelector(".launcher");
  assert.equal(panel.hidden, false);
  assert.equal(launcher.hidden, true);
  assert.equal(shadow.querySelector(".status").textContent, "");
  assert.equal(shadow.querySelector(".intro h1").textContent, "Ready to fill your application");

  shadow.querySelector(".collapse").click();
  assert.equal(panel.hidden, true);
  assert.equal(launcher.hidden, false);

  launcher.click();
  assert.equal(panel.hidden, false);
  assert.equal(launcher.hidden, true);
  dom.window.close();
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
    { chrome, console }
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
