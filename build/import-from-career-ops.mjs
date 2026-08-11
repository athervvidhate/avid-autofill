#!/usr/bin/env node
// Convert a career-ops profile (config/profile.yml + cv.md) into the extension's
// profile.json. Run: `npm run import -- [path-to-career-ops]`
// Then load profile.json from the extension's options page (Import profile.json).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(process.argv[2] || path.join(here, "..", "..", "career-ops"));
const out = path.join(here, "..", "profile.json");

function read(rel) {
  const p = path.join(src, rel);
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

const cfg = yaml.load(read("config/profile.yml")) || {};
const c = cfg.candidate || {};

// --- personal ---
const fullName = c.full_name || "";
const [firstName, ...rest] = fullName.split(" ");
const [city = "", state = ""] = (c.location || "").split(",").map((s) => s.trim());

// Derive student status / graduation date from the most recent education entry.
const educationList = parseEducation(read("cv.md"));
const gradDate = (educationList[0] && educationList[0].endDate) || "";
const gradYear = (gradDate.match(/\b(20\d{2})\b/) || [])[1];
const isStudent =
  /expected|present|current/i.test(gradDate) ||
  (gradYear && Number(gradYear) >= new Date().getFullYear());

const profile = {
  personal: {
    firstName: firstName || "",
    lastName: rest.join(" "),
    fullName,
    preferredName: "",
    email: c.email || "",
    phone: c.phone || "",
    address: "",
    city,
    state,
    postalCode: "",
    country: (cfg.location && cfg.location.country) || "United States",
    pronouns: "",
  },
  links: {
    linkedin: normUrl(c.linkedin),
    github: normUrl(c.github),
    portfolio: c.portfolio_url || "",
    website: c.portfolio_url || "",
    twitter: "",
  },
  work: parseExperience(read("cv.md")),
  education: educationList,
  eeo: { gender: "", race: "", hispanicLatino: "", veteranStatus: "", disabilityStatus: "" },
  workAuth: {
    authorizedToWork:
      cfg.location && cfg.location.needs_sponsorship === false ? "Yes" : "Yes",
    requireSponsorship:
      cfg.location && cfg.location.needs_sponsorship ? "Yes" : "No",
  },
  misc: {
    salaryExpectation: (cfg.compensation && cfg.compensation.target_range) || "",
    noticePeriod: "",
    earliestStartDate: "",
    graduationDate: gradDate,
    willingToRelocate:
      cfg.compensation && /relocat/i.test(cfg.compensation.location_flexibility || "")
        ? "Yes"
        : "Yes",
    howHeard: "",
    coverLetter: "",
    customAnswers: {},
  },
  questions: {
    previouslyEmployedHere: "No",
    formerContractorOrIntern: "No",
    // Infer "current student" from an unfinished degree (future/expected grad).
    currentStudent: isStudent ? "Yes" : "",
    consentToContact: "Yes",
    consentToOtherRoles: "Yes",
    agreeToTerms: "Yes",
    over18: "Yes",
  },
  meta: { importedAt: new Date().toISOString(), source: "career-ops" },
};

fs.writeFileSync(out, JSON.stringify(profile, null, 2));
console.log(`Wrote ${out}`);
console.log(
  `  ${profile.work.length} roles, ${profile.education.length} schools, ` +
    `contact for ${profile.personal.fullName}`
);
console.log("Next: open the extension options page and Import profile.json");

// --- helpers ---
function normUrl(u) {
  if (!u) return "";
  return /^https?:\/\//.test(u) ? u : "https://" + u.replace(/^\/+/, "");
}

// cv.md experience entries look like:
//   ### {Title} — {Company}
//   *{Start} – {End}*
//   - bullet
function parseExperience(md) {
  const block = sectionBlock(md, "Experience");
  if (!block) return [];
  const roles = [];
  for (const entry of splitEntries(block)) {
    const head = entry.head.split(/\s+[—–-]\s+/);
    const title = (head[0] || "").trim();
    const company = (head[1] || "").trim();
    const dateLine = entry.body.find((l) => /^\*.*\*$/.test(l.trim()));
    let startDate = "", endDate = "";
    if (dateLine) {
      const parts = dateLine.replace(/\*/g, "").split(/[–-]/);
      startDate = (parts[0] || "").trim();
      endDate = (parts[1] || "").trim();
    }
    const description = entry.body
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .join("\n");
    if (title || company)
      roles.push({
        title,
        company,
        location: "",
        startDate,
        endDate,
        current: /present|current/i.test(endDate),
        description,
      });
  }
  return roles;
}

function parseEducation(md) {
  const block = sectionBlock(md, "Education");
  if (!block) return [];
  const schools = [];
  for (const entry of splitEntries(block)) {
    const head = entry.head.split(/\s+[—–-]\s+/);
    const school = (head[0] || "").trim();
    const location = (head[1] || "").trim();
    const degLine = entry.body.find((l) => /\*\*/.test(l));
    let degree = "", endDate = "";
    if (degLine) {
      const bold = degLine.match(/\*\*(.+?)\*\*/);
      degree = bold ? bold[1].trim() : "";
      const grad = degLine.match(/graduation:\s*([^·]+)/i);
      if (grad) endDate = grad[1].trim();
    }
    if (school)
      schools.push({ school, degree, field: "", location, startDate: "", endDate, gpa: "" });
  }
  return schools;
}

// Return the text between "## {name}" and the next "## " heading.
function sectionBlock(md, name) {
  const re = new RegExp(`^##\\s+${name}\\s*$`, "im");
  const m = md.match(re);
  if (!m) return "";
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/^##\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// Split a section into entries keyed by "### heading".
function splitEntries(block) {
  const lines = block.split("\n");
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^###\s+(.*)$/);
    if (h) {
      if (cur) entries.push(cur);
      cur = { head: h[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) entries.push(cur);
  return entries;
}
