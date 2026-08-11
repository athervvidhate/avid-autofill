const AvidAutofill = globalThis.AvidAutofill;
const $ = (id) => document.getElementById(id);

// Field layouts: [key, label, type]. type: text | textarea | select(:opts) | checkbox
const LAYOUT = {
  personal: [
    ["firstName", "First name"], ["lastName", "Last name"],
    ["fullName", "Full name"], ["preferredName", "Preferred name"],
    ["email", "Email"], ["phone", "Phone"],
    ["address", "Street address", "wide"], ["city", "City"], ["state", "State/Province"],
    ["postalCode", "Zip/Postal"], ["country", "Country"], ["pronouns", "Pronouns"],
  ],
  links: [
    ["linkedin", "LinkedIn"], ["github", "GitHub"],
    ["portfolio", "Portfolio"], ["website", "Website"], ["twitter", "Twitter/X"],
  ],
  workAuth: [
    ["authorizedToWork", "Authorized to work?", "select:Yes|No"],
    ["requireSponsorship", "Require sponsorship?", "select:No|Yes"],
  ],
  misc: [
    ["salaryExpectation", "Salary expectation"], ["noticePeriod", "Notice period"],
    ["earliestStartDate", "Earliest start date"], ["graduationDate", "Graduation date"],
    ["willingToRelocate", "Willing to relocate?", "select:Yes|No"],
    ["howHeard", "How did you hear about us?", "wide"],
    ["coverLetter", "Default cover letter", "wide-area"],
  ],
  questions: [
    ["previouslyEmployedHere", "Previously employed here?", "select:No|Yes"],
    ["formerContractorOrIntern", "Former/current intern or contractor?", "select:No|Yes"],
    ["currentStudent", "Currently a student?", "select:|Yes|No"],
    ["consentToContact", "Consent to text/email updates?", "select:Yes|No"],
    ["consentToOtherRoles", "Consider me for other roles?", "select:Yes|No"],
    ["agreeToTerms", "Agree to legal acknowledgments?", "select:Yes|No"],
    ["over18", "Are you 18 or older?", "select:Yes|No"],
  ],
  eeo: [
    ["gender", "Gender"], ["hispanicLatino", "Hispanic/Latino?", "select:|Yes|No"],
    ["race", "Race/Ethnicity"], ["veteranStatus", "Veteran status"],
    ["disabilityStatus", "Disability status"],
  ],
};
const WORK_FIELDS = [
  ["title", "Title"], ["company", "Company"], ["location", "Location"],
  ["startDate", "Start (e.g. Jun 2025)"], ["endDate", "End (or Present)"],
  ["current", "Current role", "checkbox"], ["description", "Description", "wide-area"],
];
const EDU_FIELDS = [
  ["school", "School"], ["degree", "Degree"], ["field", "Field of study"],
  ["location", "Location"], ["startDate", "Start"], ["endDate", "End / expected"],
  ["gpa", "GPA"],
];

let profile;

function makeField(section, key, label, type) {
  const wrap = document.createElement("div");
  const wide = type === "wide" || type === "wide-area";
  wrap.className = "field" + (wide ? " wide" : "") + (type === "checkbox" ? " checkbox" : "");
  const id = `${section}.${key}`;
  let control;
  if (type && type.startsWith("select:")) {
    control = document.createElement("select");
    for (const opt of type.slice(7).split("|")) {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt || "(blank)";
      control.append(o);
    }
  } else if (type === "wide-area") {
    control = document.createElement("textarea");
  } else if (type === "checkbox") {
    control = document.createElement("input");
    control.type = "checkbox";
  } else {
    control = document.createElement("input");
    control.type = "text";
  }
  control.dataset.path = id;
  const lbl = document.createElement("label");
  lbl.className = "lbl";
  lbl.textContent = label;
  if (type === "checkbox") { wrap.append(control, lbl); }
  else { wrap.append(lbl, control); }
  return wrap;
}

function buildFlatSection(section) {
  const host = $(section);
  host.innerHTML = "";
  for (const [key, label, type] of LAYOUT[section]) {
    host.append(makeField(section, key, label, type));
  }
}

function buildCards(section, fields, items) {
  const host = $(`${section}-list`);
  host.innerHTML = "";
  items.forEach((item, i) => host.append(makeCard(section, fields, item, i)));
}

function makeCard(section, fields, item, i) {
  const card = document.createElement("div");
  card.className = "card";
  const rm = document.createElement("button");
  rm.className = "remove"; rm.textContent = "×"; rm.title = "Remove";
  rm.onclick = () => { profile[section].splice(i, 1); buildCards(section, fields, profile[section]); };
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const [key, label, type] of fields) {
    const f = makeField(`${section}[${i}]`, key, label, type);
    const ctrl = f.querySelector("[data-path]");
    if (type === "checkbox") ctrl.checked = !!item[key];
    else ctrl.value = item[key] || "";
    grid.append(f);
  }
  card.append(rm, grid);
  return card;
}

function fillFromProfile() {
  document.querySelectorAll("[data-path]").forEach((ctrl) => {
    const path = ctrl.dataset.path;
    // flat: "section.key"
    const m = path.match(/^(\w+)\.(\w+)$/);
    if (m && profile[m[1]] && m[2] in profile[m[1]]) {
      if (ctrl.type === "checkbox") ctrl.checked = !!profile[m[1]][m[2]];
      else ctrl.value = profile[m[1]][m[2]] ?? "";
    }
  });
}

function readIntoProfile() {
  document.querySelectorAll("[data-path]").forEach((ctrl) => {
    const path = ctrl.dataset.path;
    const flat = path.match(/^(\w+)\.(\w+)$/);
    const card = path.match(/^(\w+)\[(\d+)\]\.(\w+)$/);
    const val = ctrl.type === "checkbox" ? ctrl.checked : ctrl.value;
    if (flat) {
      profile[flat[1]] = profile[flat[1]] || {};
      profile[flat[1]][flat[2]] = val;
    } else if (card) {
      const [, sec, idx, key] = card;
      profile[sec][+idx] = profile[sec][+idx] || {};
      profile[sec][+idx][key] = val;
    }
  });
}

async function render() {
  profile = await AvidAutofill.getProfile();
  buildFlatSection("personal");
  buildFlatSection("links");
  buildFlatSection("workAuth");
  buildFlatSection("misc");
  buildFlatSection("questions");
  buildFlatSection("eeo");
  fillFromProfile();
  buildCards("work", WORK_FIELDS, profile.work);
  buildCards("education", EDU_FIELDS, profile.education);
}

// --- events ---
document.querySelectorAll("[data-add]").forEach((btn) => {
  btn.onclick = () => {
    const section = btn.dataset.add;
    readIntoProfile();
    profile[section].push({});
    buildCards(section, section === "work" ? WORK_FIELDS : EDU_FIELDS, profile[section]);
  };
});

$("save").onclick = async () => {
  readIntoProfile();
  await AvidAutofill.saveProfile(profile);
  flash($("save-msg"), "Saved ✓");
};

$("export").onclick = () => {
  readIntoProfile();
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "profile.json";
  a.click();
};

$("import-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    profile = AvidAutofill.mergeDefaults(AvidAutofill.DEFAULT_PROFILE, parsed);
    await AvidAutofill.saveProfile(profile);
    await render();
    flash($("io-msg"), "Imported ✓");
  } catch (err) {
    flash($("io-msg"), "Invalid JSON");
  }
  e.target.value = "";
};

function flash(node, msg) {
  node.textContent = msg;
  setTimeout(() => (node.textContent = ""), 2500);
}

// --- resume ---
async function renderResume() {
  const resume = await AvidAutofill.getResume();
  $("resume-name").textContent = resume
    ? `Saved: ${resume.name}`
    : "No resume saved";
}

$("resume-file").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    await AvidAutofill.saveResume({
      name: file.name,
      type: file.type || "application/pdf",
      dataUrl: reader.result, // base64 data: URL
    });
    await renderResume();
    flash($("resume-name"), `Saved: ${file.name} ✓`);
  };
  reader.readAsDataURL(file);
  e.target.value = "";
};

$("resume-remove").onclick = async () => {
  await AvidAutofill.clearResume();
  await renderResume();
};

render();
renderResume();
