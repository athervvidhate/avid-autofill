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

test("a Next click fills the new step once, and later redraws do not", async () => {
  const win = setup('<form id="f"><input name="first_name" aria-label="First name"><button id="n" type="button">Next</button></form>');
  let fills = 0;
  win.AvidAutofill.widget = { fill: async () => { fills += 1; return {}; } };
  win.AvidAutofill.steps.start();
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(fills, 0); // nothing fills before the first click
  win.AvidAutofill.steps.arm(); // the applicant's own Fill click
  const f = win.document.getElementById("f");
  // A redraw nobody clicked for is ignored, however many fields it adds.
  f.insertAdjacentHTML("beforeend", '<input name="email" aria-label="Email">');
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(fills, 0);
  // The Next click opens a watch window; the next page arrives a moment later.
  win.document.getElementById("n").click();
  setTimeout(() => { f.innerHTML = '<input name="city" aria-label="City"><button id="n" type="button">Next</button>'; }, 600);
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal(fills, 1);
  f.insertAdjacentHTML("beforeend", "<span>note</span>");
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(fills, 1);
}, 15000);

test("Back and Cancel do not count as a new step", async () => {
  const win = setup('<form id="f"><input name="a" aria-label="First name"><button id="b" type="button">Back</button></form>');
  let fills = 0;
  win.AvidAutofill.widget = { fill: async () => { fills += 1; return {}; } };
  win.AvidAutofill.steps.arm();
  win.document.getElementById("b").click();
  win.document.getElementById("f").insertAdjacentHTML("beforeend", '<input name="z" aria-label="Zip">');
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(fills, 0);
}, 10000);

test("turning the setting off stops automatic fills", async () => {
  const win = setup('<form><input name="first_name" aria-label="First name"></form>', { autoFillSteps: false });
  let fills = 0;
  win.AvidAutofill.widget = { fill: async () => { fills += 1; return {}; } };
  win.AvidAutofill.steps.arm();
  win.document.body.insertAdjacentHTML("beforeend", '<button id="n" type="button">Next</button><input name="x" aria-label="X">');
  win.document.getElementById("n").click();
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(fills, 0);
}, 10000);

test("a Fill on one job does not arm another job opened in the same tab", async () => {
  const html = '<form><input name="first_name" aria-label="First name"></form>';
  const first = setup(html);
  first.history.replaceState({}, "", "/acme/jobs/1a2b3c/apply");
  first.AvidAutofill.steps.arm();
  const armed = first.sessionStorage.getItem("avidStepsArmed");
  assert.equal(armed, "jobs.example.com/acme/jobs/1a2b3c");
  // A later step of the same job still counts as armed; another job does not.
  first.history.replaceState({}, "", "/acme/jobs/1a2b3c/apply/step-two");
  const second = setup(html);
  second.sessionStorage.setItem("avidStepsArmed", armed);
  second.history.replaceState({}, "", "/acme/jobs/9z8y7x/apply");
  let fills = 0;
  second.AvidAutofill.widget = { fill: async () => { fills += 1; return {}; } };
  second.AvidAutofill.steps.start();
  second.AvidAutofill.steps._settle();
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(fills, 0);
  // The same check on the armed job's own page does fill.
  second.history.replaceState({}, "", "/acme/jobs/1a2b3c/apply/step-two");
  second.AvidAutofill.steps._settle();
  await new Promise((r) => setTimeout(r, 1800));
  assert.equal(fills, 1);
}, 10000);
