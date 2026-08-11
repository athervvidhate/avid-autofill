const AvidAutofill = globalThis.AvidAutofill;
const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Pages we can inject into on demand (activeTab). chrome://, extension, and
// other privileged schemes reject scripting.executeScript.
const canInject = (tab) => /^(https?|file):/.test(tab.url || "");

// The frame the fill targets. An ATS form can be embedded in an iframe (e.g. a
// greenhouse.io frame on careers.acme.com), so we can't assume the top frame.
// Defaults to 0 (top) until a ping resolves a better one.
let targetFrameId = 0;

// Runs inside each frame's content-script world. Returns null where our content
// script isn't loaded, else what that frame sees. Must be self-contained: it is
// serialized and injected, so it can't reference popup scope.
function detectInFrame() {
  const A = globalThis.AvidAutofill;
  if (!A || !A.adapters) return null;
  const a = A.adapters.detect();
  // Count fillable fields, not <form> tags: many ATS pages (and our fixture)
  // put inputs in plain divs, and the engine fills them either way.
  const fields = document.querySelectorAll(
    "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea"
  ).length;
  return { ats: a.name, beta: !!(a.beta || a.stub), fields };
}

// Ask every frame what it sees (broadcast messaging can't enumerate frames, but
// executeScript returns a result per frame), then pick the frame most worth
// filling: a recognized ATS first, else the frame with the most fillable fields
// (an empty wrapper frame embedding an iframe has none), else the top frame.
async function resolveTarget(tabId) {
  const injections = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: detectInFrame,
  });
  const loaded = injections.filter((i) => i.result);
  if (!loaded.length) return null;
  const ats = loaded.find((i) => i.result.ats !== "Generic");
  const mostFields = loaded
    .filter((i) => i.result.fields > 0)
    .sort((a, b) => b.result.fields - a.result.fields)[0];
  const best = ats || mostFields || loaded[0];
  return { frameId: best.frameId, ...best.result };
}

// Find the ATS across all frames. If our content script isn't in any of them,
// offer to inject it on demand (embedded ATS on a domain the manifest doesn't
// match); on a page we can't script at all, fall back to disabling.
async function ping() {
  const tab = await activeTab();
  if (!canInject(tab)) {
    targetFrameId = 0;
    $("ats").textContent = "no form page";
    $("fill").disabled = true;
    $("enable-page").classList.add("hidden");
    return;
  }
  let target = null;
  try {
    target = await resolveTarget(tab.id);
  } catch (_) {
    // Some injectable-looking pages still reject scripting; treat as no form.
  }
  if (target) {
    targetFrameId = target.frameId;
    $("ats").textContent = target.beta ? `${target.ats} (beta)` : target.ats;
    $("fill").disabled = false;
    $("enable-page").classList.add("hidden");
  } else {
    targetFrameId = 0;
    $("fill").disabled = true;
    $("ats").textContent = "not enabled";
    $("enable-page").classList.remove("hidden");
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
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files });
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
    const res = await chrome.tabs.sendMessage(tab.id, { type: "AVID_FILL" }, { frameId: targetFrameId });
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
