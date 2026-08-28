import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function chromeShim() {
  const store = {};
  return {
    runtime: {
      getManifest: () => ({}),
      openOptionsPage: () => {},
      sendMessage: () => {},
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
