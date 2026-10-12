// Real Chromium check that a PDF resume is read on device and reviewed in My Info.
// Run: npm run build && AVID_BROWSER=/path/to/chromium node test/resume-browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(repo, ".output/chrome-mv3");
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "avid-resume-browser-"));
const executablePath = process.env.AVID_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// A one-page PDF with Helvetica text at the given [x, y, text] positions.
function pdf(runs) {
  const esc = s => s.replace(/[\\()]/g, "\\$&");
  const content = `BT /F1 11 Tf ${runs.map(([x, y, t]) => `1 0 0 1 ${x} ${y} Tm (${esc(t)}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
const resume = pdf([
  [50, 740, "Grace Hopper"], [50, 725, "Arlington, VA 22201 | grace@navy.example | (703) 555-0101"],
  [50, 690, "EXPERIENCE"],
  [50, 672, "Rear Admiral, United States Navy"], [450, 672, "Jan 1944 - Present"],
  [60, 656, "- Pioneered machine-independent programming languages"],
  [50, 620, "EDUCATION"],
  [50, 602, "Yale University"], [50, 588, "Ph.D. in Mathematics"], [450, 588, "1934"],
  [50, 560, "SKILLS"], [50, 544, "COBOL, FLOW-MATIC, Compilers"],
]);

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath,
  headless: true,
  args: ["--headless=new", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.setInputFiles("#resume-file", { name: "hopper.pdf", mimeType: "application/pdf", buffer: resume });
  await page.waitForSelector(".rv-dialog", { timeout: 20000 });
  const dialog = await page.innerText(".rv-dialog");
  assert.match(dialog, /Review what Avid read/);
  const values = await page.$$eval(".rv-dialog input[type=text], .rv-dialog input:not([type]), .rv-dialog textarea", nodes => nodes.map(n => n.value));
  assert.ok(values.includes("grace@navy.example"), values.join(" | "));
  await page.click("#rv-apply");
  await page.waitForSelector(".rv-dialog", { state: "detached" });
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get("avidProfile")).avidProfile);
  assert.equal(saved.personal.firstName, "Grace");
  assert.equal(saved.personal.lastName, "Hopper");
  assert.equal(saved.personal.email, "grace@navy.example");
  assert.equal(saved.personal.phone, "(703) 555-0101");
  assert.deepEqual([saved.work[0].title, saved.work[0].company, saved.work[0].startDate, saved.work[0].current], ["Rear Admiral", "United States Navy", "Jan 1944", true]);
  assert.deepEqual([saved.education[0].school, saved.education[0].degree, saved.education[0].field], ["Yale University", "Ph.D.", "Mathematics"]);
  assert.equal(saved.misc.skills, "COBOL, FLOW-MATIC, Compilers");
  assert.equal(await page.inputValue('input[data-path="personal.firstName"]'), "Grace");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true }));
} finally {
  await context.close();
  await fs.rm(profileDir, { recursive: true, force: true });
}
