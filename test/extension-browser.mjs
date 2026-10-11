// Real Chromium smoke test for the built extension's content script.
// Serves test/sample-form.html at a Greenhouse URL, checks the drawer mounts,
// then asks the content script to fill from a saved profile.
// Run: npm run build && AVID_BROWSER=/path/to/chromium node test/extension-browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(repo, ".output/chrome-mv3");
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "avid-extension-browser-"));
const form = await fs.readFile(path.join(repo, "test/sample-form.html"), "utf8");
const executablePath = process.env.AVID_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath,
  headless: true,
  args: ["--headless=new", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  assert.match(worker.url(), /\/background\.js$/);
  await worker.evaluate(() => chrome.storage.local.set({
    avidProfile: { personal: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "2025550123" } },
  }));

  await context.route("https://boards.greenhouse.io/**", route => route.fulfill({ contentType: "text/html", body: form }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto("https://boards.greenhouse.io/acme/jobs/1");
  await page.waitForSelector("#avid-autofill-root", { state: "attached", timeout: 10000 });

  const report = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs[tabs.length - 1];
    return chrome.tabs.sendMessage(tab.id, { type: "AVID_FILL" }, { frameId: 0 });
  });
  assert.equal(report.ok, true, report.error);
  assert.equal(await page.inputValue("#fn"), "Ada");
  assert.equal(await page.inputValue("#ln"), "Lovelace");
  assert.equal(await page.inputValue('input[name="email"]'), "ada@example.com");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, filled: report.report.filledCount }));
} finally {
  await context.close();
  await fs.rm(profileDir, { recursive: true, force: true });
}
