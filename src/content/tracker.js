(function () {
  if (globalThis.__avidTrackerLoaded) return;
  globalThis.__avidTrackerLoaded = true;
  const A = globalThis.AvidAutofill;
  const M = A.trackerModel;
  let root, host, watching = false, timer, routeTimer, observer, signature = "", current, previousFocus;
  const $ = selector => root.querySelector(selector);
  async function send(type, data = {}) {
    const result = await chrome.runtime.sendMessage({ type: `AVID_TRACKER_${type}`, ...data });
    if (!result?.ok) throw new Error(result?.error || "The extension was reloaded. Refresh this page to use the tracker.");
    return result;
  }
  function mount() {
    if (root) { if (!host.isConnected) document.documentElement.append(host); return; }
    host = document.createElement("div"); host.id = "avid-tracker-root";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        [hidden]{display:none!important}button,input,select,textarea{font:inherit}button,a{touch-action:manipulation}
        .card,.launcher{position:fixed;z-index:2147483647;right:20px;bottom:20px;color:#1b1c19;box-shadow:0 12px 40px #203d3526}
        .card{width:min(350px,calc(100vw - 24px));max-height:calc(100dvh - 40px);overflow:auto;background:#f8fcf9;border:1px solid #d7e4dc;border-radius:14px;padding:18px;font-size:13px;line-height:1.45}
        .launcher{background:#f2f7f4;border:1px solid #d7e4dc;border-radius:24px;padding:12px 16px;font-size:12px;font-weight:700;cursor:pointer}
        .top{display:flex;justify-content:space-between;align-items:center;gap:10px}.brand{font-size:11px;font-weight:700;color:#3459c7}.close{background:none;border:0;font-size:22px;cursor:pointer;min-width:32px;min-height:32px;color:#647269}
        h2{font-size:19px;letter-spacing:-.025em;line-height:1.2;margin:8px 0}p{margin:8px 0;color:#647269}
        label{display:grid;gap:4px;margin-top:10px;font-size:11px;font-weight:700;color:#647269}
        input,textarea,select{width:100%;min-width:0;border:1px solid #d7e4dc;border-radius:7px;padding:8px;background:#fff;color:#1b1c19;font-size:13px;font-weight:400}textarea{min-height:64px;resize:vertical}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}details{margin-top:12px}summary{cursor:pointer;color:#3459c7;font-size:12px;padding:5px 0}
        .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.actions button,.connections,.sheet{border:1px solid #d7e4dc;border-radius:8px;padding:9px 12px;background:#f2f7f4;color:#203d35;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none}
        .actions .add{background:#3459c7;color:white;border-color:#3459c7}.actions button:disabled{opacity:.55;cursor:wait}
        .message{padding:10px;border-radius:8px;background:#e6f2ec;color:#203d35}.message:empty{display:none}.message.error{background:#f8efdf;color:#815315}
        .connections,.sheet{display:inline-block;margin-top:8px}.status-note{font-size:11px}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #b1c0ef;outline-offset:2px}
        @media(max-width:400px){.card,.launcher{right:12px;bottom:12px}}
      </style>
      <button type="button" class="launcher" hidden>Track application</button>
      <section class="card" role="region" aria-label="Application tracker" hidden>
        <div class="top"><span class="brand">AVID · APPLICATION TRACKER</span><button type="button" class="close" aria-label="Close application tracker">×</button></div>
        <h2>Add to your tracker?</h2><p class="intro" role="status" aria-live="polite"></p>
        <form>
          <label>Company<input name="company" required maxlength="200" autocomplete="off"></label>
          <label>Role<input name="role" required maxlength="300" autocomplete="off"></label>
          <details><summary>Details and notes</summary>
            <label>Job URL<input name="url" type="url" required></label>
            <label>Location<input name="location" maxlength="200"></label>
            <div class="grid"><label>Status<select name="status"></select></label><label>Date applied<input name="applied" type="date"></label></div>
            <label>Follow-up date<input name="followUp" type="date"></label>
            <label>Notes<textarea name="notes" maxlength="4000"></textarea></label>
          </details>
          <div class="actions"><button type="submit" class="add">Add application</button><button type="button" class="dismiss">Not now</button></div>
        </form>
        <p class="message" role="status" aria-live="polite"></p>
        <div class="actions"><button type="button" class="again" hidden>Add another application</button></div>
        <button type="button" class="connections">Connections</button>
        <a class="sheet" target="_blank" rel="noopener noreferrer" hidden>Open tracker</a>
      </section>`;
    for (const status of M.STATUSES) { const option = document.createElement("option"); option.value = option.textContent = status; $('[name="status"]').append(option); }
    document.documentElement.append(host);
    $(".launcher").onclick = open;
    $(".close").onclick = dismiss;
    $(".dismiss").onclick = dismiss;
    $(".connections").onclick = () => send("OPEN_CONNECTIONS").catch(showError);
    $(".again").onclick = () => show({ ...current, existing: null, operationId: crypto.randomUUID() }, true, true);
    $('[name="status"]').onchange = event => {
      if (event.target.value === "Applied") {
        if (!$('[name="applied"]').value) $('[name="applied"]').value = M.today();
        if (!$('[name="followUp"]').value) $('[name="followUp"]').value = M.daysFromToday(7);
      }
    };
    $("form").addEventListener("invalid", () => { $("details").open = true; }, true);
    $("form").onsubmit = async event => {
      event.preventDefault();
      const button = $(".add");
      if (button.disabled) return;
      button.disabled = true; button.textContent = "Saving...";
      try {
        const entry = M.entry(Object.fromEntries(new FormData($("form"))));
        const result = await send("ADD", { entry, operationId: current.operationId, again: current.again });
        current = { ...current, ...result, existing: result.record };
        $("form").hidden = true;
        $(".message").textContent = result.record.state === "synced" ? result.record.duplicate ? "Already tracked. Your existing row was kept." : "Added to your tracker." : `Not synced yet. Your entry is saved in this browser. ${result.record.error || "Connect Google to finish syncing."}`;
        $(".message").classList.toggle("error", result.record.state !== "synced");
        $(".again").hidden = result.record.state !== "synced";
        link(result.sheetUrl);
      } catch (error) { showError(error); }
      finally { button.disabled = false; button.textContent = "Add application"; }
    };
    $(".card").onkeydown = event => { if (event.key === "Escape") { event.preventDefault(); dismiss(); } };
  }
  function link(url) {
    const valid = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit#gid=\d+$/.test(url || "");
    $(".sheet").hidden = !valid;
    if (valid) $(".sheet").href = url;
  }
  function showError(error) { mount(); $(".message").textContent = error.message; $(".message").classList.add("error"); }
  function show(value, manual = false, again = false) {
    mount();
    // Don't replace a draft the person is editing while the page continues changing.
    if (!manual && !$(".card").hidden) return;
    current = { ...value, again };
    previousFocus = document.activeElement;
    $(".card").hidden = false; $(".launcher").hidden = true;
    $("h2").textContent = again ? "Track another application" : value.existing ? "Application tracked" : "Add to your tracker?";
    $(".intro").textContent = value.confirmed ? "Application submitted. Check the details before adding it." : "Check the details and status. Avid has not confirmed submission.";
    const values = { ...value.job, status: value.confirmed ? "Applied" : "Saved", applied: M.today(), followUp: M.daysFromToday(7), notes: "" };
    for (const [name, val] of Object.entries(values)) { const control = $(`[name="${name}"]`); if (control) control.value = val || ""; }
    $("details").open = !value.confirmed;
    $("form").hidden = !!value.existing;
    $(".again").hidden = value.existing?.state !== "synced";
    $(".message").classList.remove("error");
    $(".message").textContent = value.existing ? value.existing.state === "synced" ? "Already tracked. Your existing row is unchanged." : `Not synced yet. Your entry is saved in this browser. ${value.existing.error || ""}` : value.connected ? "" : "Connect Google in Connections. You can save this entry locally first.";
    link(value.sheetUrl);
    if (manual) (value.existing ? $(".close") : $('[name="company"]')).focus();
  }
  async function dismiss() {
    if (current && !current.existing) {
      try { await send("DISMISS", { url: current.job.url }); }
      catch (error) { showError(error); return; }
    }
    const hadFocus = !!root.activeElement;
    $(".card").hidden = true;
    $(".launcher").hidden = !!document.querySelector("#avid-autofill-root");
    if (hadFocus) { if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus(); else if (!$(".launcher").hidden) $(".launcher").focus(); }
  }
  async function open() {
    mount();
    try { const result = await send("PREVIEW", { snapshot: A.jobDetector.inspect() }); show(result.preview, true); }
    catch (error) { $(".card").hidden = false; showError(error); }
  }
  async function scan(force = false) {
    if (!watching) return;
    let snapshot;
    try { snapshot = A.jobDetector.inspect(); } catch { return; }
    if (!snapshot) return;
    const next = JSON.stringify(snapshot);
    if (!force && next === signature) return;
    signature = next;
    if (snapshot.isJob) {
      mount();
      $(".launcher").hidden = !$(".card").hidden || !!document.querySelector("#avid-autofill-root");
    } else if (root && $(".card").hidden) $(".launcher").hidden = true;
    try { const result = await send("CAPTURE", { snapshot }); if (result.preview) show(result.preview); }
    catch { /* A reloaded extension is handled visibly if the user opens the tracker. */ }
  }
  function schedule() {
    if (host && !host.isConnected) document.documentElement.append(host);
    clearTimeout(timer); timer = setTimeout(() => scan(), 350);
  }
  function navigation() { scan(true); }
  function start(enabled) {
    if (watching === enabled) return;
    watching = enabled;
    if (!enabled) {
      observer?.disconnect(); clearTimeout(timer); clearInterval(routeTimer);
      document.removeEventListener("submit", navigation, true); document.removeEventListener("click", schedule, true);
      window.removeEventListener("pageshow", navigation); window.removeEventListener("pagehide", navigation);
      if (root && $(".card").hidden) $(".launcher").hidden = true;
      return;
    }
    signature = "";
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "class", "style"] });
    document.addEventListener("submit", navigation, true); document.addEventListener("click", schedule, true);
    window.addEventListener("pageshow", navigation); window.addEventListener("pagehide", navigation);
    let url = location.href;
    routeTimer = setInterval(() => { if (url !== location.href) { url = location.href; scan(true); } }, 1000);
    scan();
  }
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === "AVID_TRACKER_SHOW") { show(msg.preview); respond({ ok: true }); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[M.KEY]) return;
    const state = changes[M.KEY].newValue || {};
    start(!!state.enabled);
    if (current?.existing && current.existing.state !== "synced" && root && !$(".card").hidden) {
      const record = state.entries?.find(e => e.id === current.existing.id);
      if (record?.state === "synced") {
        current.existing = record; $("form").hidden = true; $(".again").hidden = false;
        $(".message").textContent = "Added to your tracker."; $(".message").classList.remove("error");
        if (state.connection?.spreadsheetId) link(`https://docs.google.com/spreadsheets/d/${state.connection.spreadsheetId}/edit#gid=${state.connection.sheetId || 0}`);
      }
    }
  });
  send("STATE").then(s => start(s.enabled)).catch(() => {});
  A.tracker = { open };
})();
