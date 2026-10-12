// First-run setup. Writes to the same storage as My Info and settings, and keeps
// only its position in a separate small record so it can resume after a close.
(function () {
  const A = globalThis.AvidAutofill, J = A.jev, $ = id => document.getElementById(id);
  const KEY = "avidOnboarding";
  const STEPS = ["welcome", "google", "jev", "import", "contact", "work", "education", "auth", "selfid", "done"];
  // Steps that can be skipped without changing anything.
  const OPTIONAL = new Set(["google", "jev", "import", "contact", "work", "education", "auth", "selfid"]);
  const FIELDS = {
    contact: [
      ["personal", "firstName", "First name"], ["personal", "lastName", "Last name"],
      ["personal", "email", "Email"], ["personal", "phone", "Phone"],
      ["personal", "city", "City"], ["personal", "state", "State/Province"],
      ["personal", "postalCode", "Zip/Postal"], ["personal", "country", "Country"],
      ["links", "linkedin", "LinkedIn"], ["links", "github", "GitHub"], ["links", "portfolio", "Portfolio"],
    ],
    auth: [
      ["workAuth", "authorizedToWork", "Authorized to work?", "Yes|No"],
      ["workAuth", "requireSponsorship", "Require sponsorship?", "No|Yes"],
      ["misc", "willingToRelocate", "Willing to relocate?", "Yes|No"],
      ["misc", "earliestStartDate", "Earliest start date"],
      ["misc", "salaryExpectation", "Salary expectation"],
    ],
    selfid: [
      ["eeo", "gender", "Gender"], ["eeo", "hispanicLatino", "Hispanic/Latino?", "|Yes|No"],
      ["eeo", "race", "Race/Ethnicity"], ["eeo", "veteranStatus", "Veteran status"],
      ["eeo", "disabilityStatus", "Disability status"],
    ],
  };
  const CARDS = {
    work: [["title", "Title"], ["company", "Company"], ["location", "Location"], ["startDate", "Start (e.g. Jun 2025)"], ["endDate", "End (or Present)"], ["current", "Current role", "checkbox"], ["description", "Description", "wide"]],
    education: [["school", "School"], ["degree", "Degree"], ["field", "Field of study"], ["location", "Location"], ["startDate", "Start"], ["endDate", "End / expected"], ["gpa", "GPA"]],
  };
  let state = { step: 0, skipped: [] }, profile, busy = false;

  const loadState = async () => { state = { step: 0, skipped: [], ...(await chrome.storage.local.get(KEY))[KEY] }; state.step = Math.min(Math.max(+state.step || 0, 0), STEPS.length - 1); };
  const saveState = () => chrome.storage.local.set({ [KEY]: state });
  async function send(type, data = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...data });
    if (!result?.ok) throw new Error(result?.error || "Reload the extension and reopen setup.");
    return result;
  }
  const say = (id, text) => { $(id).textContent = text; };

  function control(id, label, type, options) {
    const wrap = document.createElement("div");
    wrap.className = "field" + (type === "wide" ? " wide" : "") + (type === "checkbox" ? " checkbox" : "");
    const ctrl = options ? document.createElement("select") : document.createElement(type === "wide" ? "textarea" : "input");
    if (options) for (const value of options.split("|")) ctrl.append(new Option(value || "(blank)", value));
    if (type === "checkbox") ctrl.type = "checkbox";
    ctrl.id = id;
    const lbl = document.createElement("label");
    lbl.className = "lbl"; lbl.htmlFor = id; lbl.textContent = label;
    wrap.append(...(type === "checkbox" ? [ctrl, lbl] : [lbl, ctrl]));
    return [wrap, ctrl];
  }
  function buildFields(step) {
    const host = document.querySelector(`[data-fields="${step}"]`);
    host.replaceChildren();
    for (const [section, key, label, options] of FIELDS[step]) {
      const [wrap, ctrl] = control(`ob-${section}-${key}`, label, "text", options);
      ctrl.dataset.section = section; ctrl.dataset.key = key;
      const value = profile[section]?.[key] ?? "";
      // Keep a saved value that is not one of the known options.
      if (options && value && ![...ctrl.options].some(o => o.value === value)) ctrl.append(new Option(value, value));
      ctrl.value = value;
      host.append(wrap);
    }
  }
  function buildCards(step) {
    const host = document.querySelector(`[data-cards="${step}"]`);
    host.replaceChildren();
    if (!profile[step].length) profile[step].push({});
    profile[step].forEach((item, i) => {
      const card = document.createElement("div"), grid = document.createElement("div"), remove = document.createElement("button");
      card.className = "card"; grid.className = "grid";
      remove.type = "button"; remove.className = "remove"; remove.textContent = "×"; remove.title = "Remove";
      remove.onclick = async () => { readCards(step); profile[step].splice(i, 1); await persist(); buildCards(step); };
      for (const [key, label, type] of CARDS[step]) {
        const [wrap, ctrl] = control(`ob-${step}-${i}-${key}`, label, type);
        ctrl.dataset.key = key;
        if (type === "checkbox") ctrl.checked = !!item[key]; else ctrl.value = item[key] || "";
        grid.append(wrap);
      }
      card.append(remove, grid);
      host.append(card);
    });
  }
  function readCards(step) {
    const cards = [...document.querySelectorAll(`[data-cards="${step}"] .card`)];
    profile[step] = cards.map(card => Object.fromEntries([...card.querySelectorAll("[data-key]")].map(c => [c.dataset.key, c.type === "checkbox" ? c.checked : c.value])));
  }
  // Writes only what the visible step shows, over the freshest saved profile, so
  // nothing typed elsewhere (My Info in another tab) is overwritten.
  async function persist() {
    const step = STEPS[state.step], fresh = await A.getProfile();
    if (FIELDS[step]) {
      for (const ctrl of document.querySelectorAll(`[data-fields="${step}"] [data-key]`)) (fresh[ctrl.dataset.section] ||= {})[ctrl.dataset.key] = ctrl.value;
    } else if (CARDS[step]) {
      readCards(step);
      fresh[step] = profile[step].filter(item => Object.values(item).some(v => v && v !== true));
    } else return;
    await A.saveProfile(fresh);
    profile = fresh;
  }

  function summary() {
    const rows = [];
    const add = (ok, text) => rows.push([ok, text]);
    return Promise.all([send("AVID_TRACKER_STATE").catch(() => ({})), send("AVID_JEV_STATE").catch(() => ({})), A.getProfile(), A.getResume()]).then(([google, jev, p, resume]) => {
      add(google.connected, google.connected ? `Google connected${google.email ? ` as ${google.email}` : ""}` : "Google not connected. The tracker is off.");
      add(jev.enabled && jev.hasKey, jev.enabled && jev.hasKey ? "Jev is on" : "Jev is off. Avid fills with its built-in matching.");
      add(!!resume, resume ? `Resume saved: ${resume.name}` : "No resume saved");
      const name = [p.personal.firstName, p.personal.lastName].filter(Boolean).join(" ");
      add(!!(name || p.personal.email), name || p.personal.email ? `Profile: ${name || p.personal.email}` : "Contact details not added yet");
      add(p.work.length > 0, `${p.work.length} ${p.work.length === 1 ? "role" : "roles"} and ${p.education.length} ${p.education.length === 1 ? "school" : "schools"} saved`);
      const host = $("ob-summary");
      host.replaceChildren(...rows.map(([ok, text]) => { const li = document.createElement("li"); li.className = ok ? "ok" : "todo"; li.textContent = text; return li; }));
    });
  }

  async function show() {
    const step = STEPS[state.step];
    for (const section of document.querySelectorAll("[data-step]")) section.hidden = section.dataset.step !== step;
    $("ob-count").textContent = step === "done" ? "All done" : `Step ${state.step + 1} of ${STEPS.length - 1}`;
    $("ob-fill").style.width = `${(state.step / (STEPS.length - 1)) * 100}%`;
    $("ob-back").hidden = state.step === 0;
    $("ob-skip").hidden = !OPTIONAL.has(step);
    document.querySelector(".ob-nav").hidden = step === "done";
    $("ob-next").textContent = step === "welcome" ? "Get started" : "Continue";
    window.scrollTo(0, 0);
    if (FIELDS[step]) buildFields(step);
    if (CARDS[step]) buildCards(step);
    if (step === "google") await refreshGoogle();
    if (step === "jev") await refreshJev();
    if (step === "import") await refreshResume();
    if (step === "done") await summary();
    document.querySelector(`[data-step="${step}"] h1`)?.setAttribute("tabindex", "-1");
    document.querySelector(`[data-step="${step}"] h1`)?.focus({ preventScroll: true });
  }
  async function go(to, mode) {
    if (busy) return;
    if (mode !== "skip") await persist();
    const id = STEPS[state.step];
    if (mode === "skip") state.skipped = [...new Set([...state.skipped, id])];
    else if (mode === "next") state.skipped = state.skipped.filter(s => s !== id);
    state.step = Math.min(Math.max(to, 0), STEPS.length - 1);
    if (STEPS[state.step] === "done") state.done = true;
    await saveState();
    await show();
  }

  // Google: the same one-click connect as My Info. The email is the only profile
  // detail the existing scopes return, and it only fills an empty email field.
  async function refreshGoogle() {
    try {
      const s = await send("AVID_TRACKER_STATE");
      say("ob-google-account", s.email || "Not connected");
      say("ob-google-badge", s.connected ? "Connected" : "Not connected");
      $("ob-google-connect").textContent = s.connected ? "Reconnect Google" : "Sign in with Google";
      $("ob-google-connect").disabled = busy || !s.configured;
      if (!s.configured) say("ob-google-msg", "This build has no built-in Google connection. You can add your own client later in My Info.");
      return s;
    } catch (e) { say("ob-google-msg", e.message); }
  }
  $("ob-google-connect").onclick = async () => {
    if (busy) return;
    busy = true; $("ob-google-connect").disabled = true;
    say("ob-google-msg", "Finish signing in in Google's window...");
    try {
      await send("AVID_TRACKER_CONNECT");
      const s = await send("AVID_TRACKER_STATE"), fresh = await A.getProfile();
      if (s.email && !fresh.personal.email) { fresh.personal.email = s.email; await A.saveProfile(fresh); profile = fresh; }
      say("ob-google-msg", "Connected. Your tracker spreadsheet is ready.");
    } catch (e) { say("ob-google-msg", e.message); }
    busy = false;
    await refreshGoogle();
  };

  // Jev: ask for TypeSafe access from this click, check the key with one tiny
  // request, and only then store it and turn Jev on.
  async function refreshJev() {
    try {
      const s = await send("AVID_JEV_STATE");
      $("ob-jev-remove").hidden = !s.hasKey && !s.enabled;
      say("ob-jev-msg", s.enabled && s.hasKey ? "Jev is on." : s.hasKey ? "A key is saved but Jev is off." : "");
    } catch (e) { say("ob-jev-msg", e.message); }
  }
  $("ob-jev-save").onclick = async () => {
    const key = $("ob-jev-key").value.trim();
    if (busy) return;
    if (!key || /\s/.test(key)) { say("ob-jev-msg", "Paste your Jev API key, or skip this step."); return; }
    busy = true; $("ob-jev-save").disabled = true; say("ob-jev-msg", "Checking the key...");
    try {
      if (!await chrome.permissions.request({ origins: [J.ORIGIN] })) throw new Error("Jev stays off until TypeSafe AI access is allowed.");
      const check = await send("AVID_JEV_VERIFY", { key });
      if (!check.valid) throw new Error("Jev rejected that key. Check it and paste it again.");
      await send("AVID_JEV_SAVE", { enabled: true, key });
      $("ob-jev-key").value = "";
      say("ob-jev-msg", "Key works. Jev is on.");
      $("ob-jev-remove").hidden = false;
    } catch (e) { say("ob-jev-msg", e.message); }
    busy = false; $("ob-jev-save").disabled = false;
  };
  $("ob-jev-remove").onclick = async () => {
    try { await send("AVID_JEV_CLEAR"); $("ob-jev-key").value = ""; } catch (e) { say("ob-jev-msg", e.message); return; }
    await refreshJev(); say("ob-jev-msg", "Key removed. Jev is off.");
  };

  async function refreshResume() {
    const resume = await A.getResume();
    say("ob-resume-name", resume ? `Saved: ${resume.name}` : "No resume saved");
    $("ob-resume-read").hidden = !resume;
  }
  // Reads the resume on this device, then lets the user review before anything is saved.
  async function readResume(blob) {
    if (busy) return;
    busy = true; $("ob-resume-read").disabled = true;
    say("ob-resume-msg", "Reading your resume...");
    try {
      const merged = await A.importResume(blob, await A.getProfile());
      if (merged) {
        await A.saveProfile(merged); profile = merged;
        say("ob-resume-msg", "Added to your profile. The next steps show what it filled in.");
      } else say("ob-resume-msg", "Nothing was added.");
    } catch (e) { say("ob-resume-msg", e.message); }
    busy = false; $("ob-resume-read").disabled = false;
  }
  $("ob-resume-file").onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await A.saveResume({ name: file.name, type: file.type || "application/pdf", dataUrl: reader.result });
      await refreshResume();
      await readResume(file);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };
  $("ob-resume-read").onclick = async () => {
    const resume = await A.getResume();
    if (resume) await readResume(await (await fetch(resume.dataUrl)).blob());
  };
  $("ob-import-file").onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      profile = A.mergeDefaults(A.DEFAULT_PROFILE, JSON.parse(await file.text()));
      await A.saveProfile(profile);
      say("ob-import-msg", "Imported. The next steps show what it filled in.");
    } catch { say("ob-import-msg", "That file is not a valid profile export."); }
    event.target.value = "";
  };

  document.querySelectorAll("[data-add]").forEach(button => {
    button.onclick = () => { const step = button.dataset.add; readCards(step); profile[step].push({}); buildCards(step); };
  });
  // Save as the user types so a closed tab loses nothing.
  document.addEventListener("change", event => { if (event.target.closest?.("[data-fields],[data-cards]")) persist().catch(() => {}); });
  $("ob-next").onclick = () => go(state.step + 1, "next");
  $("ob-skip").onclick = () => go(state.step + 1, "skip");
  $("ob-back").onclick = () => go(state.step - 1, "back");
  $("ob-finish").onclick = async () => { await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") }); window.close(); };

  (async () => {
    await loadState();
    profile = await A.getProfile();
    // Reopened from My Info after finishing: start over, keeping nothing but the data.
    if (state.done || new URLSearchParams(location.search).has("restart")) { state = { step: 0, skipped: [] }; await saveState(); }
    await show();
  })();
})();
