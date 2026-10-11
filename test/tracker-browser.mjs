// Real Chromium smoke test, no Google account or personal browser profile used.
// Run: npm run build && AVID_BROWSER=/path/to/chromium node test/tracker-browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "avid-tracker-browser-"));
const extension = path.join(scratch, "extension");
const profile = path.join(scratch, "profile");
await fs.cp(path.join(repo, ".output/chrome-mv3"), extension, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(extension, "manifest.json"), "utf8"));
// Headless Chromium cannot show the native host-permission consent dialog.
// This temporary copy represents a user who already granted broad career-site access.
manifest.host_permissions.push(...manifest.optional_host_permissions);
await fs.writeFile(path.join(extension, "manifest.json"), JSON.stringify(manifest));
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><title>Software Engineer at Acme</title><style>body{font:18px system-ui;max-width:720px;margin:80px auto;color:#203d35;background:#fafcfb}input,button{display:block;margin:16px 0;padding:12px}h1{font-size:38px}</style></head><body>${req.url.split("?")[0] === "/thanks" ? '<h1>Application submitted</h1><p>Thank you for applying. We will review your application.</p>' : '<p>ACME CAREERS</p><h1>Software Engineer</h1><div class="company-name">Acme</div><form action="/thanks"><label for="resume">Resume</label><input id="resume" type="file"><input type="email"><button>Submit application</button></form>'}</body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executable = process.env.AVID_BROWSER || "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const context = await chromium.launchPersistentContext(profile, {
  executablePath: executable,
  headless: true,
  viewport: { width: 1100, height: 900 },
  args: ["--headless=new", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value; } catch {} await delay(100); }
  throw new Error(`Timed out waiting for ${label}`);
}
try {
  const worker = context.serviceWorkers().find(w => w.url().endsWith("/background.js")) || await context.waitForEvent("serviceworker", w => w.url().endsWith("/background.js"));
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  // The worker opens My Info on install; open it directly if this browser has not.
  const optionsOpen = () => context.pages().find(p => p.url().startsWith(`${base}/options.html`));
  for (let i = 0; i < 30 && !optionsOpen(); i++) await delay(100);
  const options = optionsOpen() || await context.newPage();
  if (!options.url().startsWith(base)) await options.goto(`${base}/options.html`);
  await options.waitForLoadState("load");
  await options.setViewportSize({ width: 1100, height: 900 });
  const state = await options.evaluate(() => chrome.runtime.sendMessage({ type: "AVID_TRACKER_STATE" }));
  assert.equal(state.ok, true); assert.equal(state.configured, false); assert.match(state.redirectUrl, /chromiumapp\.org\/google$/);
  await until(() => options.evaluate(() => document.querySelector("#google-setup").open), "setup instructions");
  await options.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; document.querySelector("#connections").scrollIntoView({ behavior: "instant" }); });
  await until(() => options.evaluate(() => document.querySelector("#connections").getBoundingClientRect().top < 50), "Connections in viewport");
  await options.screenshot({ path: path.join(scratch, "connections.png") });
  const enabled = await options.evaluate(() => chrome.runtime.sendMessage({ type: "AVID_TRACKER_ENABLE", enabled: true }));
  assert.equal(enabled.ok, true, enabled.error);
  const registrations = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.ok(registrations.some(s => s.id === "avid-job-tracker"));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${origin}/careers/engineer`);
  await until(() => page.evaluate(() => !!document.querySelector("#avid-tracker-root")), "automatic unfamiliar-site detection");
  assert.equal(await page.evaluate(() => !!document.querySelector("#avid-autofill-root")), false);
  assert.equal(await page.evaluate(() => document.querySelector("#avid-tracker-root").shadowRoot.querySelector(".card").hidden), true);
  await page.evaluate(() => document.querySelector("form button").click());
  await until(() => page.evaluate(() => location.pathname === "/thanks" && document.querySelector("#avid-tracker-root")?.shadowRoot.querySelector(".card").hidden === false), "confirmed-submission prompt after full navigation");
  const details = await page.evaluate(() => Object.fromEntries(new FormData(document.querySelector("#avid-tracker-root").shadowRoot.querySelector("form"))));
  assert.equal(details.company, "Acme"); assert.equal(details.role, "Software Engineer"); assert.equal(details.url, `${origin}/careers/engineer`); assert.equal(details.status, "Applied");
  await page.screenshot({ path: path.join(scratch, "submission-prompt.png") });
  await page.evaluate(() => document.querySelector("#avid-tracker-root").shadowRoot.querySelector(".add").click());
  await until(() => page.evaluate(() => document.querySelector("#avid-tracker-root").shadowRoot.querySelector(".message").textContent.includes("Not synced yet")), "durable local save");
  const records = await worker.evaluate(() => chrome.storage.local.get("avidTracker").then(v => v.avidTracker.entries));
  assert.equal(records.length, 1); assert.equal(records[0].entry.company, "Acme"); assert.equal(records[0].state, "pending");
  await page.reload();
  await delay(800);
  assert.equal(await page.evaluate(() => document.querySelector("#avid-tracker-root")?.shadowRoot.querySelector(".card").hidden === false), false);
  console.log(JSON.stringify({ result: "passed", browser: executable, screenshots: [path.join(scratch, "connections.png"), path.join(scratch, "submission-prompt.png")], checks: ["real extension worker", "Connections", "registered broad detection", "full navigation without autofill", "editable job metadata", "durable local save", "no repeat prompt"] }, null, 2));
} finally {
  await context.close();
  server.close();
}
