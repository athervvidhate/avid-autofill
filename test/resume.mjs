import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { JSDOM } from "jsdom";
import { docxXmlToText, extractResumeText, pdfItemsToText, readZipEntries } from "../src/shared/resume-extract.ts";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function loadParser() {
  globalThis.AvidAutofill = {};
  new Function(read("src/shared/resume-parse.js"))();
  return globalThis.AvidAutofill;
}

const TRADITIONAL = `JANE Q. DOE
San Francisco, CA 94107 | jane.doe@gmail.com | (415) 555-0134
linkedin.com/in/janedoe | github.com/janedoe | janedoe.dev

EXPERIENCE
Senior Software Engineer, Stripe — San Francisco, CA          Jan 2021 – Present
• Built payment APIs serving 10M requests per day
• Led migration to TypeScript
Software Engineer, Acme Corp                                   June 2018 - Dec 2020
- Wrote services in Go and Python

EDUCATION
University of Texas at Austin
B.S. in Computer Science, GPA: 3.8/4.0      2014 – 2018

SKILLS
Languages: Python, Go, TypeScript
Tools: Docker, Kubernetes, AWS`;

const STACKED = `John Smith
john@smith.com · 555-123-4567 · Boston, MA
Work Experience
Acme Inc.
Product Manager
05/2019 - 08/2022
Drove roadmap for the mobile team.
Shipped 12 features.
Globex Corporation
Associate Product Manager
Jul 2016 - Apr 2019
Ran customer interviews.
Education
Massachusetts Institute of Technology
Master of Science in Computer Science
2016
Boston University
Bachelor of Arts, Economics
2012 - 2016
Skills
Python, SQL, Figma`;

test("reads contact details, links and name from the header", () => {
  const p = loadParser().parseResumeText(TRADITIONAL);
  assert.deepEqual(p.personal, { email: "jane.doe@gmail.com", phone: "(415) 555-0134", city: "San Francisco", state: "CA", postalCode: "94107", firstName: "Jane", lastName: "Q. Doe", fullName: "Jane Q. Doe" });
  assert.deepEqual(p.links, { linkedin: "https://linkedin.com/in/janedoe", github: "https://github.com/janedoe", portfolio: "https://janedoe.dev" });
});

test("splits jobs on date ranges with the title and company on the same line", () => {
  const { work } = loadParser().parseResumeText(TRADITIONAL);
  assert.equal(work.length, 2);
  assert.deepEqual({ ...work[0], description: undefined }, { title: "Senior Software Engineer", company: "Stripe", location: "San Francisco, CA", startDate: "Jan 2021", endDate: "", current: true, description: undefined });
  assert.equal(work[0].description, "Built payment APIs serving 10M requests per day\nLed migration to TypeScript");
  assert.deepEqual([work[1].title, work[1].company, work[1].startDate, work[1].endDate, work[1].current], ["Software Engineer", "Acme Corp", "Jun 2018", "Dec 2020", false]);
});

test("reads jobs and schools laid out one detail per line", () => {
  const p = loadParser().parseResumeText(STACKED);
  assert.deepEqual(p.work.map(w => [w.title, w.company, w.startDate, w.endDate]), [
    ["Product Manager", "Acme Inc.", "May 2019", "Aug 2022"],
    ["Associate Product Manager", "Globex Corporation", "Jul 2016", "Apr 2019"],
  ]);
  assert.equal(p.work[0].description, "Drove roadmap for the mobile team.\nShipped 12 features.");
  assert.deepEqual(p.education.map(e => [e.school, e.degree, e.field, e.endDate]), [
    ["Massachusetts Institute of Technology", "Master of Science", "Computer Science", "2016"],
    ["Boston University", "Bachelor of Arts", "Economics", "2016"],
  ]);
});

test("reads education details and skills, dropping category labels", () => {
  const p = loadParser().parseResumeText(TRADITIONAL);
  assert.deepEqual(p.education, [{ school: "University of Texas at Austin", degree: "B.S.", field: "Computer Science", location: "", startDate: "2014", endDate: "2018", gpa: "3.8" }]);
  assert.deepEqual(p.skills, ["Python", "Go", "TypeScript", "Docker", "Kubernetes", "AWS"]);
});

// Company and dates on one line, the title on the next, bullets that wrap, and a PDF column gap
// between the school and its city.
const COMPANY_FIRST = `Sam Rivera
(555)-010-0199 | sam@example.com | samrivera.dev | in/samrivera | github.com/samrivera
Education
State University, Springfield | Springfield, IL
B.S. Data Science, Minor in Business Analytics | Expected March 2027
• GPA: 3.91/4.00.
• Research Assistant: built a Python collector for 100,000+ records with retry and checkpoint
support, delivering 300+ grouped publications for the lab lead.
Experience
Acme Technologies | June 2026 - Present
Machine Learning Engineer Intern
• Built a Python anomaly pipeline across 38 forecast models, cutting monthly review volume 88%.
Benchmarked 6 detection methods to select a production configuration.
• Routed validator issues into 3 severity levels and sent them to
engineering, QA, or integration teams.
Globex | Jan 2026 - June 2026
AI Research Intern
• Built a 6-agent workflow with Redis Streams.
Initech | Aug 2025 - Jan 2026
Full-Stack Developer Intern
• Served 1,000+ concurrent users.
Technical skills
Languages : Python, SQL`;

test("reads a company-and-date line followed by the title, and wrapped bullets", () => {
  const p = loadParser().parseResumeText(COMPANY_FIRST);
  assert.deepEqual(p.work.map(w => [w.title, w.company, w.startDate, w.endDate, w.current]), [
    ["Machine Learning Engineer Intern", "Acme Technologies", "Jun 2026", "", true],
    ["AI Research Intern", "Globex", "Jan 2026", "Jun 2026", false],
    ["Full-Stack Developer Intern", "Initech", "Aug 2025", "Jan 2026", false],
  ]);
  assert.equal(p.work[0].description, "Built a Python anomaly pipeline across 38 forecast models, cutting monthly review volume 88%.\nBenchmarked 6 detection methods to select a production configuration.\nRouted validator issues into 3 severity levels and sent them to engineering, QA, or integration teams.");
  assert.deepEqual(p.education, [{ school: "State University, Springfield", degree: "B.S.", field: "Data Science", location: "Springfield, IL", startDate: "", endDate: "Mar 2027", gpa: "3.91" }]);
  assert.equal(p.links.linkedin, "https://linkedin.com/in/samrivera");
});

test("returns nothing rather than guessing for text that is not a resume", () => {
  const p = loadParser().parseResumeText("Lorem ipsum dolor sit amet.\nNothing to see here.");
  assert.deepEqual([p.work, p.education, p.skills, p.personal.email], [[], [], [], undefined]);
});

// A minimal .docx: a zip with deflated header and document parts.
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = zlib.deflateRawSync(Buffer.from(text)), nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(8, 10); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(text.length, 24); dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data); central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const para = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

test("extracts DOCX text from the header and body", async () => {
  const docx = zip({
    "word/header1.xml": `<w:hdr>${para("Ada Lovelace")}${para("ada@example.com")}</w:hdr>`,
    "word/document.xml": `<w:document><w:body>${para("EXPERIENCE")}<w:p><w:r><w:t>Engineer &amp; Analyst</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>2020 - Present</w:t></w:r></w:p></w:body></w:document>`,
  });
  const text = await extractResumeText(new Blob([docx]));
  assert.equal(text.split("\n").filter(Boolean).join("|"), "Ada Lovelace|ada@example.com|EXPERIENCE|Engineer & Analyst \t 2020 - Present");
  assert.deepEqual(Object.keys(await readZipEntries(docx.buffer.slice(docx.byteOffset, docx.byteOffset + docx.length), n => n.endsWith("document.xml"))), ["word/document.xml"]);
  assert.equal(docxXmlToText("<w:p><w:t>a</w:t><w:br/><w:t>b</w:t></w:p>"), "a\nb\n");
});

test("rejects files that are neither PDF nor DOCX and files with no text", async () => {
  await assert.rejects(extractResumeText(new Blob([Buffer.from("D0CF11E0")])), /PDF and DOCX/);
  await assert.rejects(extractResumeText(new Blob([zip({ "word/document.xml": "<w:document><w:body/></w:document>" })])), /No text found/);
});

test("joins PDF text runs into lines by baseline and position", () => {
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const wide = (str, x, y, width) => ({ ...item(str, x, y), width });
  const text = pdfItemsToText([[item("2021", 400, 700), item("Engineer, Stripe", 40, 700.5), item("Built APIs", 60, 680), item("JANE DOE", 40, 760)]]);
  assert.equal(text, "JANE DOE\nEngineer, Stripe 2021\nBuilt APIs");
  // A wide gap between runs becomes a column marker; a normal word gap does not.
  assert.equal(pdfItemsToText([[wide("State University", 40, 700, 80), wide("Springfield, IL", 400, 700, 70), wide("B.S.", 40, 680, 20), wide("Data", 62, 680, 20)]]), "State University | Springfield, IL\nB.S. Data");
});

// --- review dialog and import ---
function page() {
  const dom = new JSDOM("<body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  for (const file of ["src/shared/schema.js", "src/shared/resume-parse.js", "src/shared/resume-review.js"]) dom.window.eval(read(file));
  return dom;
}
// Values built inside the jsdom window have that window's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const tickN = async () => { await tick(); await tick(); };

test("review fills empty fields, leaves differing ones unticked, and skips saved entries", async () => {
  const dom = page(), A = dom.window.AvidAutofill, doc = dom.window.document;
  const parsed = A.parseResumeText(TRADITIONAL);
  const profile = A.mergeDefaults(A.DEFAULT_PROFILE, {
    personal: { firstName: "Jane", email: "old@example.com" },
    work: [{ title: "Software Engineer", company: "Acme Corp", endDate: "Dec 2020" }],
    misc: { skills: "Go, Rust" },
  });
  const result = A.reviewResumeImport(parsed, profile);
  await tickN();
  const boxes = [...doc.querySelectorAll(".rv-overlay input[type=checkbox]")];
  const byLabel = text => doc.querySelector(`label[for="${[...doc.querySelectorAll("label.lbl")].find(l => l.textContent === text).htmlFor}"]`).htmlFor;
  assert.ok(boxes.length > 5);
  // Email differs from what is saved: shown as a replacement and not ticked.
  const emailBox = doc.getElementById(byLabel("Email").replace(/-v$/, "-on"));
  assert.equal(emailBox.checked, false);
  assert.ok([...doc.querySelectorAll(".rv-existing")].some(n => /Replaces: old@example.com/.test(n.textContent)));
  // Phone is empty in the profile: ticked.
  assert.equal(doc.getElementById(byLabel("Phone").replace(/-v$/, "-on")).checked, true);
  // The role already saved is unticked, the new one ticked.
  const adds = [...doc.querySelectorAll(".rv-add")];
  assert.deepEqual(adds.map(a => [a.textContent, a.querySelector("input").checked]), [["Senior Software Engineer at Stripe", true], ["Software Engineer at Acme Corp (already saved)", false], ["B.S., University of Texas at Austin", true]]);
  // An edit made in the dialog is what gets saved.
  doc.getElementById(byLabel("Phone")).value = "415-555-9999";
  doc.getElementById("rv-apply").click();
  const merged = await result;
  assert.equal(merged.personal.phone, "415-555-9999");
  assert.equal(merged.personal.email, "old@example.com");
  assert.equal(merged.personal.firstName, "Jane");
  assert.deepEqual(plain(merged.work.map(w => w.company)), ["Stripe", "Acme Corp"]);
  assert.equal(merged.work[0].current, true);
  assert.equal(merged.education[0].school, "University of Texas at Austin");
  assert.equal(merged.misc.skills, "Go, Rust, Python, TypeScript, Docker, Kubernetes, AWS");
  assert.equal(merged.meta.source, "resume");
  assert.equal(profile.personal.phone, "", "the original profile is not mutated");
  assert.equal(doc.querySelector(".rv-overlay"), null);
});

test("cancelling the review changes nothing", async () => {
  const dom = page(), A = dom.window.AvidAutofill, doc = dom.window.document;
  const result = A.reviewResumeImport(A.parseResumeText(TRADITIONAL), A.mergeDefaults(A.DEFAULT_PROFILE, {}));
  await tickN();
  doc.getElementById("rv-cancel").click();
  assert.equal(await result, null);
});

test("importResume reads the file, then reviews", async () => {
  const dom = page(), A = dom.window.AvidAutofill, doc = dom.window.document;
  A.extractResumeText = async () => STACKED;
  const result = A.importResume({}, A.mergeDefaults(A.DEFAULT_PROFILE, {}));
  await tickN();
  doc.getElementById("rv-apply").click();
  const merged = await result;
  assert.equal(merged.personal.email, "john@smith.com");
  assert.deepEqual(plain(merged.work.map(w => w.title)), ["Product Manager", "Associate Product Manager"]);
  A.extractResumeText = async () => "nothing useful here";
  await assert.rejects(A.importResume({}, merged), /could not find/);
});
