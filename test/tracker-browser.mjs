// Real Chromium smoke test, no Google account or personal browser profile used.
// Run: AVID_BROWSER=/path/to/chromium node test/tracker-browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "avid-tracker-browser-"));
const extension = path.join(scratch, "extension");
const profile = path.join(scratch, "profile");
await fs.mkdir(extension);
for (const file of ["src", "icons", "manifest.json"]) await fs.cp(path.join(repo, file), path.join(extension, file), { recursive: true });
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
const child = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank"], { stdio: "ignore" });
const sockets = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value; } catch {} await delay(100); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function cdp(url) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(); let id = 0;
  socket.onmessage = event => { const msg = JSON.parse(event.data); const pair = pending.get(msg.id); if (pair) { pending.delete(msg.id); msg.error ? pair.reject(new Error(msg.error.message)) : pair.resolve(msg.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + " " + result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  return { send, evaluate };
}
try {
  const port = await until(async () => Number((await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]), "browser");
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const workerTarget = await until(async () => (await targets()).find(t => t.type === "service_worker" && t.url.includes("src/background/service-worker.js")), "extension service worker");
  const worker = await cdp(workerTarget.webSocketDebuggerUrl);
  const base = `chrome-extension://${new URL(workerTarget.url).host}`;
  const optionsTarget = await until(async () => (await targets()).find(t => t.url.startsWith(base) && t.url.includes("options.html")), "Connections page");
  const options = await cdp(optionsTarget.webSocketDebuggerUrl);
  await options.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  const state = await options.evaluate('chrome.runtime.sendMessage({type:"AVID_TRACKER_STATE"})');
  assert.equal(state.ok, true); assert.equal(state.configured, false); assert.match(state.redirectUrl, /chromiumapp\.org\/google$/);
  await until(() => options.evaluate('document.querySelector("#google-setup").open'), "setup instructions");
  await options.evaluate('document.documentElement.style.scrollBehavior="auto"; document.querySelector("#connections").scrollIntoView({behavior:"instant"})');
  await until(() => options.evaluate('document.querySelector("#connections").getBoundingClientRect().top < 50'), "Connections in viewport");
  await fs.writeFile(path.join(scratch, "connections.png"), Buffer.from((await options.send("Page.captureScreenshot")).data, "base64"));
  const enabled = await options.evaluate('chrome.runtime.sendMessage({type:"AVID_TRACKER_ENABLE",enabled:true})');
  assert.equal(enabled.ok, true, enabled.error);
  const registrations = await worker.evaluate("chrome.scripting.getRegisteredContentScripts()");
  assert.ok(registrations.some(s => s.id === "avid-job-tracker"));
  const newPage = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${origin}/careers/engineer`)}`, { method: "PUT" })).json();
  const page = await cdp(newPage.webSocketDebuggerUrl);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await until(() => page.evaluate('!!document.querySelector("#avid-tracker-root")'), "automatic unfamiliar-site detection");
  assert.equal(await page.evaluate('!!document.querySelector("#avid-autofill-root")'), false);
  assert.equal(await page.evaluate('document.querySelector("#avid-tracker-root").shadowRoot.querySelector(".card").hidden'), true);
  await page.evaluate('document.querySelector("form button").click()');
  await until(() => page.evaluate('location.pathname === "/thanks" && document.querySelector("#avid-tracker-root")?.shadowRoot.querySelector(".card").hidden === false'), "confirmed-submission prompt after full navigation");
  const details = await page.evaluate('Object.fromEntries(new FormData(document.querySelector("#avid-tracker-root").shadowRoot.querySelector("form")))');
  assert.equal(details.company, "Acme"); assert.equal(details.role, "Software Engineer"); assert.equal(details.url, `${origin}/careers/engineer`); assert.equal(details.status, "Applied");
  await fs.writeFile(path.join(scratch, "submission-prompt.png"), Buffer.from((await page.send("Page.captureScreenshot")).data, "base64"));
  await page.evaluate('document.querySelector("#avid-tracker-root").shadowRoot.querySelector(".add").click()');
  await until(() => page.evaluate('document.querySelector("#avid-tracker-root").shadowRoot.querySelector(".message").textContent.includes("Not synced yet")'), "durable local save");
  const records = await worker.evaluate('chrome.storage.local.get("avidTracker").then(v => v.avidTracker.entries)');
  assert.equal(records.length, 1); assert.equal(records[0].entry.company, "Acme"); assert.equal(records[0].state, "pending");
  await page.send("Page.reload");
  await delay(800);
  assert.equal(await page.evaluate('document.querySelector("#avid-tracker-root")?.shadowRoot.querySelector(".card").hidden === false'), false);
  console.log(JSON.stringify({ result: "passed", browser: executable, screenshots: [path.join(scratch, "connections.png"), path.join(scratch, "submission-prompt.png")], checks: ["real extension worker", "Connections", "registered broad detection", "full navigation without autofill", "editable job metadata", "durable local save", "no repeat prompt"] }, null, 2));
} finally {
  sockets.forEach(socket => socket.close());
  child.kill();
  server.close();
}
