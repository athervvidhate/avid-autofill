// Cross-site dump: runs the unpacked extension in a throwaway browser profile on
// public application pages with a fake applicant (Ada Lovelace), then lists every
// visible control with its label, type and value after the fill, plus the fill
// report. Never submits, never creates accounts.
//   AVID_BROWSER=/path/to/chromium node test/live/crosssite.mjs <out-dir> <url>[|click:Apply] ...
// A "|click:Text" suffix clicks the first button or link with that text before filling.
// Writes <out-dir>/<n>.json and <n>.png.
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [out, ...targets] = process.argv.slice(2);
if (!out || !targets.length) throw new Error("Usage: node test/live/crosssite.mjs <out-dir> <url>[|click:Text]...");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "avid-crosssite-"));
const ext = path.join(scratch, "extension");
await fs.mkdir(ext); await fs.mkdir(out, { recursive: true });
await fs.cp(path.join(repo, ".output/chrome-mv3"), ext, { recursive: true }); // npm run build first
const manifest = JSON.parse(await fs.readFile(path.join(ext, "manifest.json"), "utf8"));
manifest.host_permissions.push(...(manifest.optional_host_permissions || []));
await fs.writeFile(path.join(ext, "manifest.json"), JSON.stringify(manifest));

const ctx = await chromium.launchPersistentContext(path.join(scratch, "profile"), {
  executablePath: process.env.AVID_BROWSER || "/Applications/Helium.app/Contents/MacOS/Helium",
  headless: !process.env.HEADED, viewport: { width: 1280, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const hardStop = setTimeout(() => { console.error("crosssite exceeded its time limit"); process.exit(2); }, 150000 * targets.length);
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
await sw.evaluate(async () => {
  const profile = { personal: {}, links: {}, misc: {}, eeo: {} };
  Object.assign(profile.personal, { firstName: "Ada", lastName: "Lovelace", fullName: "Ada Lovelace", email: "ada@example.com", phone: "2025550123", address: "12 Example Way", city: "Portland", state: "Oregon", postalCode: "97201" });
  Object.assign(profile.links, { linkedin: "https://www.linkedin.com/in/ada-example", github: "https://github.com/ada-example", portfolio: "https://ada.example.dev" });
  Object.assign(profile.misc, { skills: "TypeScript, React, Node.js", salaryExpectation: "150000", noticePeriod: "Two weeks", earliestStartDate: "2027-01-15", graduationDate: "May 2018", howHeard: "Company website" });
  profile.work = [{ company: "Analytical Engines Ltd", title: "Senior Software Engineer", location: "Portland, OR", startDate: "Jun 2021", current: true, description: "Built the billing platform." }, { company: "Difference Co", title: "Software Engineer", location: "Seattle, WA", startDate: "Jul 2018", endDate: "May 2021", description: "Shipped internal tools." }];
  profile.education = [{ school: "University of Washington", degree: "Bachelor of Science", field: "Computer Science", startDate: "Sep 2014", endDate: "May 2018", gpa: "3.8" }];
  Object.assign(profile.eeo, { gender: "Female", race: "White", hispanicLatino: "No", veteranStatus: "I am not a protected veteran", disabilityStatus: "No, I do not have a disability" });
  await chrome.storage.local.set({ avidProfile: profile, avidSettings: { fillEEO: true } });
});

// Sites outside the manifest's platform list need "any site" mode; flip it from the options page, the only sender it accepts.
const extId = new URL(sw.url()).host, options = await ctx.newPage();
await options.goto(`chrome-extension://${extId}/options.html`);
console.log("anysite:", JSON.stringify(await options.evaluate(() => chrome.runtime.sendMessage({ type: "AVID_ANYSITE_SET", enabled: true }))));
await options.close();

const dump = () => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
  const labelOf = (el) => {
    const parts = [];
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    const by = el.getAttribute("aria-labelledby");
    if (by) parts.push(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "));
    if (el.labels?.length) parts.push([...el.labels].map((l) => l.textContent).join(" "));
    if (!parts.join("").trim()) { const wrap = el.closest("label, fieldset, [class*=field], [class*=question], [class*=form-group]"); if (wrap) parts.push(wrap.querySelector("legend, label, [class*=label]")?.textContent || wrap.textContent.slice(0, 80)); }
    if (el.placeholder) parts.push(`(ph: ${el.placeholder})`);
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 110);
  };
  return [...document.querySelectorAll("input, select, textarea, [role=combobox]")]
    .filter((el) => visible(el) && !["hidden", "submit", "button", "image"].includes(el.type))
    .map((el) => {
      const checkable = el.type === "checkbox" || el.type === "radio";
      let value = checkable ? (el.checked ? "[x]" : "[ ]") : el.tagName === "SELECT" ? (el.selectedOptions[0]?.textContent || "").trim() : (el.value || el.textContent || "");
      const shown = el.closest('[class*="select__control"], [class*="control"]')?.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"]');
      if (!value && shown) value = `{${shown.textContent.trim()}}`;
      if (checkable) value += ` ${el.closest("label")?.textContent?.trim().slice(0, 40) || el.value}`;
      return { label: labelOf(el), tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute("role"), name: el.name || el.id || "", value: String(value).slice(0, 80) };
    });
};

for (const [n, target] of targets.entries()) {
  const cut = target.indexOf("|"), url = cut < 0 ? target : target.slice(0, cut), step = cut < 0 ? "" : target.slice(cut + 1), record = { url, step: step || "" };
  const page = await ctx.newPage();
  try {
    for (let attempt = 1; ; attempt++) {
      try { await page.goto(url, { waitUntil: "load", timeout: 45000 }); break; }
      catch (error) { if (attempt === 3) throw error; await page.waitForTimeout(3000); }
    }
    await page.waitForTimeout(5000);
    if (step?.startsWith("click:")) {
      const text = step.slice(6);
      await page.getByRole("link", { name: new RegExp(text, "i") }).or(page.getByRole("button", { name: new RegExp(text, "i") })).first().click({ timeout: 10000 });
      await page.waitForTimeout(6000);
    }
    record.finalUrl = page.url();
    await (await ctx.newCDPSession(page)).send("Emulation.setFocusEmulationEnabled", { enabled: false });
    const elsewhere = await ctx.newPage(); await elsewhere.bringToFront();
    record.before = await page.evaluate(dump);
    record.fill = await sw.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({}), tab = tabs.find((t) => t.url === u) || tabs.find((t) => t.url?.startsWith(u.split("#")[0].split("?")[0]));
      return chrome.tabs.sendMessage(tab.id, { type: "AVID_FILL" }, { frameId: 0 });
    }, page.url());
    await page.waitForTimeout(2000);
    await elsewhere.close();
    record.after = await page.evaluate(dump);
    record.frames = page.frames().map((f) => f.url()).filter((u) => u !== "about:blank");
    await page.screenshot({ path: path.join(out, `${n}.png`), fullPage: true });
  } catch (error) { record.error = String(error.message || error).slice(0, 300); }
  await fs.writeFile(path.join(out, `${n}.json`), JSON.stringify(record, null, 2));
  const report = record.fill?.report;
  console.log(n, url, record.error || `${report?.ats}: ${report?.filledCount} filled, ${record.after.length} controls`);
  await Promise.race([page.close(), new Promise((r) => setTimeout(r, 5000))]);
}
await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 5000))]);
await fs.rm(scratch, { recursive: true, force: true });
clearTimeout(hardStop);
process.exit(0);
