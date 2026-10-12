// Workday commit helpers: the key-event wrapper, the re-entry of fields Workday
// still flags invalid, and holding a fill until the page has had a real gesture.
import { test } from "vitest";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = ["src/shared/schema.js", "src/content/fillers.js", "src/content/workday.js"].map((p) => fs.readFileSync(path.join(ROOT, p), "utf8"));

function load(html) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://acme.wd5.myworkdayjobs.com/en-US/x/apply" });
  for (const src of SCRIPTS) dom.window.eval(src);
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }];
  dom.window.AvidAutofill.fillers.sleep = async () => {};
  return dom.window;
}

test("with keyEvents on, a text fill sends keydown, keypress, input and keyup", () => {
  const win = load('<input id="t">');
  const seen = [];
  const t = win.document.getElementById("t");
  for (const type of ["keydown", "keypress", "input", "keyup"]) t.addEventListener(type, () => seen.push(type));
  win.AvidAutofill.fillers.keyEvents = true;
  win.AvidAutofill.fillers.setTextValue(t, "Engineer");
  assert.equal(t.value, "Engineer");
  assert.deepEqual([seen[0], seen[1], seen.at(-1)], ["keydown", "keypress", "keyup"]);
  assert.ok(seen.includes("input"));
});

test("with keyEvents off (every other ATS), no key events are sent", () => {
  const win = load('<input id="t">');
  let keys = 0;
  const t = win.document.getElementById("t");
  t.addEventListener("keydown", () => keys++);
  win.AvidAutofill.fillers.setTextValue(t, "Engineer");
  assert.equal(keys, 0);
});

test("recommitPass re-enters a filled field Workday still flags invalid, and skips valid ones", async () => {
  const win = load('<input id="bad" aria-invalid="true" value="Acme"><input id="ok" aria-invalid="false" value="Fine"><input id="empty" aria-invalid="true">');
  const rows = [];
  const n = await win.AvidAutofill.workday.recommitPass({ fillers: win.AvidAutofill.fillers, record: (...a) => rows.push(a) });
  assert.equal(n, 1);
  assert.equal(rows[0][1], "Acme");
  assert.equal(win.document.getElementById("bad").value, "Acme");
  assert.equal(win.AvidAutofill.fillers.keyEvents, false);
});

test("whenUserActive resolves at once when the page has already had a gesture, and times out otherwise", async () => {
  const win = load("<body></body>");
  Object.defineProperty(win.navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
  assert.equal(await win.AvidAutofill.fillers.whenUserActive(50), true);
  Object.defineProperty(win.navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
  assert.equal(await win.AvidAutofill.fillers.whenUserActive(30), false);
});
