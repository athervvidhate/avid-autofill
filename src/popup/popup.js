const AvidAutofill = globalThis.AvidAutofill;
const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Ask the content script which ATS it sees. If the content script isn't there
// (e.g. chrome:// pages), disable filling.
async function ping() {
  const tab = await activeTab();
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "AVID_PING" });
    $("ats").textContent = res.beta ? `${res.ats} (beta)` : res.ats;
  } catch (_) {
    $("ats").textContent = "no form page";
    $("fill").disabled = true;
  }
}

async function loadState() {
  const profile = await AvidAutofill.getProfile();
  const hasProfile = profile.personal.email || profile.personal.fullName;
  $("no-profile").classList.toggle("hidden", !!hasProfile);

  const settings = await AvidAutofill.getSettings();
  $("overwrite").checked = settings.overwriteFilled;
  $("eeo").checked = settings.fillEEO;
}

async function persistSettings() {
  const settings = await AvidAutofill.getSettings();
  settings.overwriteFilled = $("overwrite").checked;
  settings.fillEEO = $("eeo").checked;
  await AvidAutofill.saveSettings(settings);
}

function renderReport(report) {
  $("summary").classList.remove("hidden");
  const label = report.stub
    ? `${report.ats} isn't fully supported yet — generic fill used.`
    : `Filled ${report.filledCount} field${report.filledCount === 1 ? "" : "s"} on ${report.ats}.`;
  $("summary").textContent = label;

  const ul = $("results");
  ul.innerHTML = "";
  for (const r of report.results) {
    const li = document.createElement("li");
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = r.label;
    const val = document.createElement("span");
    val.className = `val st-${r.status}`;
    val.textContent = r.status === "filled" || r.status === "checked" ? r.value : r.status;
    val.title = `${r.value} — ${r.status}`;
    li.append(lbl, val);
    ul.append(li);
  }
}

$("fill").addEventListener("click", async () => {
  await persistSettings();
  $("fill").disabled = true;
  $("fill").textContent = "Filling…";
  try {
    const tab = await activeTab();
    const res = await chrome.tabs.sendMessage(tab.id, { type: "AVID_FILL" });
    if (res.ok) renderReport(res.report);
    else $("summary").textContent = "Error: " + res.error, $("summary").classList.remove("hidden");
  } finally {
    $("fill").disabled = false;
    $("fill").textContent = "Fill this page";
  }
});

for (const id of ["overwrite", "eeo"]) $(id).addEventListener("change", persistSettings);
for (const id of ["open-options-1", "open-options-2"])
  $(id).addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

ping();
loadState();
