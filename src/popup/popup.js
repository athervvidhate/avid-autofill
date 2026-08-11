const AvidAutofill = globalThis.AvidAutofill;
const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Pages we can inject into on demand (activeTab). chrome://, extension, and
// other privileged schemes reject scripting.executeScript.
const canInject = (tab) => /^(https?|file):/.test(tab.url || "");

// Ask the content script which ATS it sees. If it isn't there, offer to inject
// it on demand (embedded ATS on a custom domain the manifest doesn't match) or,
// on a page we can't script, fall back to disabling.
async function ping() {
  const tab = await activeTab();
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "AVID_PING" });
    $("ats").textContent = res.beta ? `${res.ats} (beta)` : res.ats;
    $("fill").disabled = false;
    $("enable-page").classList.add("hidden");
  } catch (_) {
    $("fill").disabled = true;
    const injectable = canInject(tab);
    $("ats").textContent = injectable ? "not enabled" : "no form page";
    $("enable-page").classList.toggle("hidden", !injectable);
  }
}

// Inject the same content scripts the manifest declares, then re-ping. The list
// comes from the manifest so it can't drift; main.js guards double-injection.
async function enableOnPage() {
  const btn = $("enable-btn");
  btn.disabled = true;
  btn.textContent = "Enabling…";
  try {
    const tab = await activeTab();
    const files = chrome.runtime.getManifest().content_scripts[0].js;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    } catch (err) {
      // e.g. file:// pages without "Allow access to file URLs" reject here.
      console.error("Avid Autofill: couldn't inject content scripts", err);
      $("ats").textContent = "couldn't enable";
      return;
    }
    // Injection succeeded; verify separately so a benign ping failure isn't
    // reported as an injection failure.
    await ping();
  } finally {
    btn.disabled = false;
    btn.textContent = "Enable on this page";
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

$("enable-btn").addEventListener("click", enableOnPage);

for (const id of ["overwrite", "eeo"]) $(id).addEventListener("change", persistSettings);
for (const id of ["open-options-1", "open-options-2"])
  $(id).addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

ping();
loadState();
