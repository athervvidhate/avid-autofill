// Auto-fill of each new application step (steps.js).
import { test } from "vitest";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function setup(html, settings = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://jobs.example.com/apply" });
  const win = dom.window;
  const store = { avidSettings: settings };
  win.chrome = { storage: { local: {
    async get(k) { return k == null ? { ...store } : { [k]: store[k] }; },
    async set(o) { Object.assign(store, o); },
    async remove(k) { delete store[k]; },
  } } };
  for (const p of ["src/shared/schema.js", "src/content/fillers.js"]) win.eval(read(p));
  win.eval(read("src/content/steps.js"));
  // Every element counts as rendered under jsdom.
  win.AvidAutofill.fillers.isRendered = () => true;
  return win;
}

test("a field that appears after a step change is fresh once, then not again", () => {
  const win = setup('<form><input name="first_name" aria-label="First name"></form>');
  const steps = win.AvidAutofill.steps;
  assert.equal(steps._freshFields().length, 1);
  win.document.querySelector("form").insertAdjacentHTML("beforeend", '<input name="email" aria-label="Email">');
  assert.equal(steps._freshFields().length, 2);
});

test("filled and hidden fields are not fresh", () => {
  const win = setup('<form><input name="a" value="x"><input type="hidden" name="b"><input type="password" name="c"><input name="d" disabled></form>');
  const fresh = win.AvidAutofill.steps._freshFields();
  assert.equal(fresh.length, 0);
});

test("a new step fills once when the page changes", async () => {
  const win = setup('<form id="f"><input name="first_name" aria-label="First name"></form>');
  let fills = 0;
  win.AvidAutofill.widget = { fill: async () => { fills += 1; return {}; } };
  win.AvidAutofill.steps.start();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(fills, 1);
  win.document.getElementById("f").innerHTML = '<input name="phone" aria-label="Phone">';
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(fills, 2);
  win.document.getElementById("f").insertAdjacentHTML("beforeend", "<span>note</span>");
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(fills, 2);
}, 15000);

test("turning the setting off stops automatic fills", async () => {
  const win = setup('<form><input name="first_name" aria-label="First name"></form>', { autoFillSteps: false });
  let fills = 0;
  win.AvidAutofill.widget = { fill: async () => { fills += 1; return {}; } };
  win.AvidAutofill.steps.start();
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(fills, 0);
}, 10000);
