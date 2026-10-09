// Real-form walkthrough: runs the unpacked extension in a throwaway browser
// profile on public application pages with the synthetic applicant from
// jev-cases.js. Jev is enabled with a dummy key; its requests are recorded,
// never sent, and answered 401, so the rule fills, the fields Jev would receive
// and the error path are all visible. Never submits.
//   AVID_BROWSER=/path/to/chromium node test/live/walk.mjs <out-dir> <url>...
// Writes <out-dir>/<n>.json (fill report, Jev requests, controls) and <n>.png.
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [out, ...urls] = process.argv.slice(2);
if (!out || !urls.length) throw new Error("Usage: node test/live/walk.mjs <out-dir> <url>...");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "avid-walk-"));
const ext = path.join(scratch, "extension");
await fs.mkdir(ext); await fs.mkdir(out, { recursive: true });
for (const f of ["src", "icons", "manifest.json"]) await fs.cp(path.join(repo, f), path.join(ext, f), { recursive: true });
// A headless browser cannot show the host-permission prompt; this copy stands
// for a user who granted career-site and TypeSafe access.
const manifest = JSON.parse(await fs.readFile(path.join(ext, "manifest.json"), "utf8"));
manifest.host_permissions.push(...manifest.optional_host_permissions, "https://api.typesafe.ai/*");
await fs.writeFile(path.join(ext, "manifest.json"), JSON.stringify(manifest));

const ctx = await chromium.launchPersistentContext(path.join(scratch, "profile"), {
  executablePath: process.env.AVID_BROWSER || "/Applications/Helium.app/Contents/MacOS/Helium",
  headless: !process.env.HEADED, viewport: { width: 1280, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const hardStop = setTimeout(() => { console.error("walk exceeded its time limit"); process.exit(2); }, 120000 * urls.length);
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
const cases = await fs.readFile(path.join(repo, "test/live/jev-cases.js"), "utf8");
const synthetic = new Function(`${cases}; return globalThis.JEV_PROFILE;`)();
await sw.evaluate(async synthetic => {
  const A = globalThis.AvidAutofill, profile = structuredClone(A.DEFAULT_PROFILE);
  Object.assign(profile.personal, synthetic.personal);
  Object.assign(profile.links, synthetic.links);
  profile.misc.skills = synthetic.misc.skills;
  profile.questionBank = synthetic.questionBank.map(e => ({ ...e, anySite: e.anySite || e.approved }));
  await chrome.storage.local.set({ avidProfile: profile, avidSettings: { ...A.DEFAULT_SETTINGS, jevEnabled: true } });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.session.set({ avidJevKey: "walkthrough-dummy-key" });
  globalThis.__jev = [];
  const send = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.typesafe.ai/")) { globalThis.__jev.push(JSON.parse(init.body)); return new Response("{}", { status: 401 }); }
    return send(url, init);
  };
}, synthetic);

const visibleControls = () => [...document.querySelectorAll("input, select, textarea")]
  .filter(el => el.offsetParent !== null && !["hidden", "submit", "button", "file"].includes(el.type))
  .map(el => ({ name: el.name || el.id || "", type: el.type, value: el.type === "checkbox" || el.type === "radio" ? (el.checked ? "checked" : "") : (el.value || "").slice(0, 60) }));
for (const [n, url] of urls.entries()) {
  const page = await ctx.newPage(), record = { url, at: new Date().toISOString() };
  try {
    for (let attempt = 1; ; attempt++) {
      try { await page.goto(url, { waitUntil: "load", timeout: 45000 }); break; }
      catch (error) { if (attempt === 3) throw error; await page.waitForTimeout(3000); }
    }
    await page.waitForTimeout(6000); // SPA forms render after load
    await sw.evaluate(() => { globalThis.__jev.length = 0; });
    record.fill = await sw.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url: url.split("#")[0] + "*" });
      return chrome.tabs.sendMessage(tab.id, { type: "AVID_FILL" }, { frameId: 0 });
    }, page.url());
    await page.waitForTimeout(1500);
    record.jevRequests = await sw.evaluate(() => globalThis.__jev);
    record.controls = await page.evaluate(visibleControls);
    record.dropdowns = await page.evaluate(() => [...document.querySelectorAll('[class*="select__control"]')]
      .map(c => ({ id: c.querySelector("input")?.id || "", shown: (c.querySelector('[class*="single-value"], [class*="singleValue"]')?.textContent || "").trim() })));
    await page.screenshot({ path: path.join(out, `${n}.png`), fullPage: true });
  } catch (error) { record.error = String(error.message || error).slice(0, 300); }
  await fs.writeFile(path.join(out, `${n}.json`), JSON.stringify(record, null, 2));
  const report = record.fill?.report;
  console.log(n, url, record.error || `${report?.ats}: ${report?.filledCount} filled, ${record.jevRequests.flatMap(r => Object.keys(r.state.fields)).length} field(s) for Jev`);
  await Promise.race([page.close(), new Promise(r => setTimeout(r, 5000))]);
}
await Promise.race([ctx.close(), new Promise(r => setTimeout(r, 5000))]);
await fs.rm(scratch, { recursive: true, force: true });
clearTimeout(hardStop);
process.exit(0);
