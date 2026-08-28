// Page-mounted drawer for supported job applications.
// It lives in a shadow root so employer page styles cannot affect it.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, input { font: inherit; }
    .wrap { --paper: #f2f7f4; --surface: #f8fcf9; --ink: #1b1c19; --muted: #647269; --line: #d7e4dc;
      --accent: #3459c7; --accent-soft: #e5ebff; --accent-press: #2947a2; --mark: #c8e86a;
      --ok: #28765b; --ok-soft: #e6f2ec; --warn: #a36516; --warn-soft: #f8efdf; --error: #b34848;
      position: fixed; inset: 0 0 0 auto; z-index: 2147483647; color: var(--ink); }
    .panel { position: absolute; inset: 0 0 0 auto; display: grid; grid-template-rows: auto auto 1fr auto;
      width: min(380px, calc(100vw - 18px)); max-width: 100vw; background: var(--paper); color: var(--ink);
      border-left: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
      box-shadow: -16px 0 44px rgba(35,30,33,.16); overflow: hidden; }
    .panel[hidden] { display: none; }
    .panel:not([hidden]) { animation: drawer-in .22s cubic-bezier(.23,1,.32,1); }
    @keyframes drawer-in { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 18px;
      background: color-mix(in srgb, var(--surface) 78%, transparent); border-bottom: 1px solid var(--line); }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .mark { width: 30px; height: 30px; display: grid; place-items: center; flex: none; border-radius: 8px 14px 8px 14px;
      background: var(--mark); color: #1b2814; font-size: 14px; font-weight: 800; }
    .titles { min-width: 0; }
    .titles b { display: block; font-size: 14px; line-height: 1.15; }
    .eyebrow { display: block; margin-top: 3px; color: var(--muted); font-size: 10px; font-weight: 750; line-height: 1.15;
      letter-spacing: .09em; text-transform: uppercase; }
    .icon-button, .launcher { border: 1px solid var(--line); cursor: pointer; }
    .icon-button { width: 38px; height: 38px; border-radius: 10px; background: var(--surface); color: var(--ink); font-size: 21px; line-height: 1; }
    .icon-button:hover { background: var(--accent-soft); }
    .icon-button:focus-visible, .launcher:focus-visible, button:focus-visible, summary:focus-visible, a:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 2px; }
    .intro { padding: 22px 18px 17px; }
    .status { display: inline-flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: 999px;
      color: var(--ok); background: var(--ok-soft); font-size: 10px; font-weight: 750; line-height: 1.1; letter-spacing: .04em; text-transform: uppercase; }
    .status:empty { display: none; }
    .status.warn { color: var(--warn); background: var(--warn-soft); }
    .status.error { color: var(--error); background: color-mix(in srgb, var(--error) 12%, transparent); }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .intro h1 { margin: 6px 0 5px; font-size: 23px; line-height: 1.1; letter-spacing: -.03em; }
    .intro p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .primary { width: 100%; min-height: 50px; margin-top: 17px; padding: 12px 14px; border: 0; border-radius: 9px;
      background: var(--accent); color: #f8fbff; cursor: pointer; font-size: 14px; font-weight: 750; box-shadow: 0 4px 0 var(--accent-press); }
    .primary:hover { filter: brightness(1.06); }
    .primary:active { transform: translateY(2px); box-shadow: 0 2px 0 var(--accent-press); }
    .primary:disabled { opacity: .58; cursor: wait; }
    details.preferences { margin-top: 10px; border: 1px solid var(--line); border-radius: 10px; background: color-mix(in srgb, var(--surface) 56%, transparent); }
    details.preferences summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 10px 12px;
      cursor: pointer; list-style: none; font-size: 12px; font-weight: 700; }
    details.preferences summary::-webkit-details-marker { display: none; }
    details.preferences summary::after { content: "›"; color: var(--muted); font-size: 17px; transform: rotate(0deg); transition: transform .16s ease; }
    details.preferences[open] summary::after { transform: rotate(90deg); }
    .toggles { display: grid; gap: 10px; padding: 0 12px 12px; }
    .toggles label { display: flex; align-items: flex-start; gap: 9px; color: var(--muted); cursor: pointer; font-size: 12px; line-height: 1.35; }
    .toggles input { width: 16px; height: 16px; flex: none; margin: 0; accent-color: var(--accent); }
    .ledger { min-height: 0; overflow: auto; padding: 0 18px 24px; }
    .summary { margin: 0 0 17px; }
    .summary[hidden] { display: none; }
    .summary-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .summary-head strong { max-width: 225px; font-size: 14px; line-height: 1.3; }
    .metrics { display: flex; align-items: center; gap: 8px; }
    .metric { padding: 7px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); }
    .metric b { margin-right: 3px; font-size: 15px; font-variant-numeric: tabular-nums; }
    .metric span { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .group { margin-top: 19px; }
    .group h2 { margin: 0 0 7px; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; }
    .results { list-style: none; margin: 0; padding: 0; }
    .result { display: grid; grid-template-columns: 5px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 46px;
      border-top: 1px solid var(--line); font-size: 13px; }
    .result:nth-child(odd) { background: color-mix(in srgb, var(--surface) 55%, transparent); }
    .result:first-child { border-top: 0; }
    .rail { width: 3px; height: 23px; border-radius: 99px; background: var(--ok); }
    .result.review .rail { background: var(--warn); }
    .result.error .rail { background: var(--error); }
    .result-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-value { max-width: 150px; overflow: hidden; color: var(--muted); text-align: right; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 700; }
    .empty { padding: 14px 0; color: var(--muted); font-size: 13px; }
    .notice { padding: 11px 12px; border-radius: 10px; background: var(--warn-soft); color: var(--warn); font-size: 12px; line-height: 1.4; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 57px; padding: 12px 18px;
      border-top: 1px solid var(--line); background: var(--surface); }
    .foot a { color: var(--accent); cursor: pointer; font-size: 12.5px; font-weight: 750; text-decoration: none; }
    .review { color: var(--muted); font-size: 11px; text-align: right; }
    .launcher { position: fixed; top: 50%; right: 0; width: 44px; height: 112px; transform: translateY(-50%); border-radius: 14px 0 0 14px;
      background: var(--accent); color: white; box-shadow: -8px 12px 28px rgba(35,30,33,.18); writing-mode: vertical-rl;
      font-size: 11px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
    .launcher[hidden] { display: none; }
    .dev { display: flex; align-items: center; gap: 6px; padding: 10px 18px; border-top: 1px dashed var(--line); background: repeating-linear-gradient(45deg, transparent, transparent 6px, color-mix(in srgb, var(--warn) 8%, transparent) 6px, color-mix(in srgb, var(--warn) 8%, transparent) 12px); }
    .dev input { min-width: 0; flex: 1; padding: 7px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); font-size: 12px; }
    .dev button { padding: 7px 10px; border: 1px solid var(--warn); border-radius: 8px; background: none; color: var(--warn); cursor: pointer; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .dev-msg { padding: 0 18px 10px; color: var(--muted); font-size: 11px; }
    .dev-msg:empty { display: none; }
    @media (prefers-reduced-motion: reduce) {
      .panel:not([hidden]) { animation: none; }
      details.preferences summary::after { transition: none; }
    }
  `;

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  let mounted = false;
  let openDrawer = null;

  function mount(adapter) {
    if (mounted || document.getElementById("avid-autofill-root")) return;
    mounted = true;

    const host = document.createElement("div");
    host.id = "avid-autofill-root";
    const root = host.attachShadow({ mode: "open" });
    (document.body || document.documentElement).appendChild(host);

    const atsLabel = adapter.beta ? `${adapter.name} (beta)` : adapter.name;
    const fillLabel = adapter.name === "Generic" ? "Try filling this page" : "Fill this application";
    root.appendChild(el(`<style>${STYLE}</style>`));
    const wrap = el(`<div class="wrap"></div>`);
    const launcher = el(`<button class="launcher" hidden aria-label="Open Avid Autofill">Open Avid</button>`);
    const panel = el(`
      <section class="panel" role="dialog" aria-label="Avid Autofill" aria-modal="false">
        <header class="top">
          <div class="brand"><span class="mark" aria-hidden="true">A</span><div class="titles"><b>Avid Autofill</b><span class="eyebrow">${atsLabel}</span></div></div>
          <button class="icon-button collapse" aria-label="Collapse Avid Autofill">›</button>
        </header>
        <section class="intro">
          <span class="eyebrow">Use your saved profile</span>
          <span class="status" aria-live="polite"></span>
          <h1>Ready to fill your application</h1>
          <p>Use your saved profile to fill matching fields. You review everything before submitting.</p>
          <button class="primary fill">Fill this application</button>
          <details class="preferences">
            <summary>Fill preferences</summary>
            <div class="toggles">
              <label><input type="checkbox" class="ov" /> <span>Replace fields that already have a value</span></label>
              <label><input type="checkbox" class="eeo" /> <span>Fill voluntary self-ID questions</span></label>
            </div>
          </details>
        </section>
        <section class="ledger">
          <div class="summary" hidden role="status" aria-live="polite"></div>
          <div class="results"></div>
        </section>
        <footer class="foot"><a class="opt" role="button" tabindex="0">Edit profile</a><span class="review">Stored locally<br />Review before submitting</span></footer>
      </section>
    `);
    wrap.append(panel, launcher);
    root.appendChild(wrap);

    const $ = (selector) => panel.querySelector(selector);
    const setOpen = (value) => {
      panel.hidden = !value;
      launcher.hidden = value;
      launcher.setAttribute("aria-expanded", String(value));
      panel.setAttribute("aria-hidden", String(!value));
      if (value) syncToggles();
    };
    openDrawer = () => { setOpen(true); return true; };
    setOpen(true);

    if (adapter.name === "Generic") {
      $(".status").className = "status warn";
      $(".status").innerHTML = `<i class="status-dot"></i> Generic form`;
      $(".intro h1").textContent = "Check this page before filling";
      $(".intro p").textContent = "Avid did not recognize this site. You can try matching fields, then review every result.";
      $(".fill").textContent = "Try filling this page";
    }

    launcher.addEventListener("click", () => setOpen(true));
    $(".collapse").addEventListener("click", () => setOpen(false));
    $(".opt").addEventListener("click", () => chrome.runtime.sendMessage({ type: "AVID_OPEN_OPTIONS" }));
    $(".opt").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chrome.runtime.sendMessage({ type: "AVID_OPEN_OPTIONS" }); }
    });
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) setOpen(false); });

    async function syncToggles() {
      const s = await AvidAutofill.getSettings();
      $(".ov").checked = s.overwriteFilled;
      $(".eeo").checked = s.fillEEO;
    }
    async function persistToggles() {
      const s = await AvidAutofill.getSettings();
      s.overwriteFilled = $(".ov").checked;
      s.fillEEO = $(".eeo").checked;
      await AvidAutofill.saveSettings(s);
    }
    $(".ov").addEventListener("change", persistToggles);
    $(".eeo").addEventListener("change", persistToggles);

    if (isDevBuild()) mountDevTools(panel, adapter);

    $(".fill").addEventListener("click", async () => {
      const btn = $(".fill");
      btn.disabled = true;
      btn.textContent = "Filling…";
      $(".status").className = "status";
      $(".status").innerHTML = `<i class="status-dot"></i> Filling`;
      try {
        await persistToggles();
        const profile = await AvidAutofill.getProfile();
        if (!profile.personal.email && !profile.personal.fullName) {
          renderEmpty($);
          return;
        }
        const settings = await AvidAutofill.getSettings();
        const resume = await AvidAutofill.getResume();
        const report = await AvidAutofill.engine.fillPage(profile, settings, resume);
        renderReport($, report);
      } catch (err) {
        renderError($, String((err && err.message) || err));
      } finally {
        btn.disabled = false;
        btn.textContent = fillLabel;
      }
    });
  }

  function renderEmpty($) {
    $(".status").className = "status warn";
    $(".status").innerHTML = `<i class="status-dot"></i> Profile needed`;
    $(".summary").hidden = false;
    $(".summary").innerHTML = `<div class="notice">No profile is saved yet. Use <b>Edit profile</b> below to add your details.</div>`;
    $(".results").innerHTML = "";
  }

  function renderError($, message) {
    $(".status").className = "status error";
    $(".status").innerHTML = `<i class="status-dot"></i> Fill failed`;
    $(".summary").hidden = false;
    $(".summary").innerHTML = "";
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = message || "Avid could not fill this page.";
    $(".summary").append(notice);
    $(".results").innerHTML = "";
  }

  function renderReport($, report) {
    const summary = $(".summary");
    summary.hidden = false;
    summary.innerHTML = "";
    if (report.blocked) {
      $(".status").className = "status warn";
      $(".status").innerHTML = `<i class="status-dot"></i> Needs attention`;
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = report.message || "This page could not be filled.";
      summary.append(notice);
      $(".results").innerHTML = "";
      return;
    }

    const done = report.results.filter((r) => r.status === "filled" || r.status === "checked");
    const review = report.results.filter((r) => !done.includes(r));
    $(".status").className = review.length ? "status warn" : "status";
    $(".status").innerHTML = `<i class="status-dot"></i> ${review.length ? "Review needed" : "Ready to submit"}`;
    const head = document.createElement("div");
    head.className = "summary-head";
    const title = document.createElement("strong");
    title.textContent = review.length ? `${report.filledCount} fields filled. Check the items below.` : `${report.filledCount} fields filled on ${report.ats}.`;
    head.append(title);
    summary.append(head);
    const metrics = document.createElement("div");
    metrics.className = "metrics";
    [[done.length, "Filled"], [review.length, "Review"], [report.results.length, "Matched"]].forEach(([count, label]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      metric.innerHTML = `<b></b><span></span>`;
      metric.querySelector("b").textContent = count;
      metric.querySelector("span").textContent = label;
      metrics.append(metric);
    });
    summary.append(metrics);

    const results = $(".results");
    results.innerHTML = "";
    if (!report.results.length) {
      results.innerHTML = `<p class="empty">No matching fields found on this page.</p>`;
      return;
    }
    if (review.length) appendGroup(results, "Needs review", review);
    if (done.length) appendGroup(results, "Filled", done);
  }

  function appendGroup(host, title, rows) {
    const group = document.createElement("section");
    group.className = "group";
    const heading = document.createElement("h2");
    heading.textContent = title;
    group.append(heading);
    const list = document.createElement("ul");
    list.className = "results";
    for (const r of rows) {
      const completed = r.status === "filled" || r.status === "checked";
      const li = document.createElement("li");
      li.className = `result${completed ? "" : r.status === "error" ? " error" : " review"}`;
      const rail = document.createElement("i");
      rail.className = "rail";
      const label = document.createElement("span");
      label.className = "result-label";
      label.textContent = r.label;
      const value = document.createElement("span");
      value.className = "result-value";
      value.textContent = completed ? r.value : statusLabel(r.status);
      value.title = `${r.value || ""} · ${statusLabel(r.status)}`;
      li.append(rail, label, value);
      list.append(li);
    }
    group.append(list);
    host.append(group);
  }

  function statusLabel(status) {
    return ({ "kept-existing": "Kept existing", skipped: "Skipped", "no-option-match": "No match", error: "Error" })[status] || status;
  }

  // --- Dev-only fixture capture -------------------------------------------
  function isDevBuild() {
    try { return !("update_url" in chrome.runtime.getManifest()); }
    catch (_) { return false; }
  }

  function collectPii(profile) {
    const vals = [];
    const push = (v) => { const s = String(v == null ? "" : v).trim(); if (s.length >= 3) vals.push(s); };
    const p = profile.personal || {};
    [p.firstName, p.lastName, p.fullName, p.preferredName, p.email, p.phone, p.address, p.city, p.postalCode].forEach(push);
    Object.values(profile.links || {}).forEach(push);
    return [...new Set(vals)].sort((a, b) => b.length - a.length);
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function buildFixtureHtml(profile) {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("#avid-autofill-root, script").forEach((n) => n.remove());
    clone.querySelectorAll("input").forEach((i) => {
      const t = (i.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox" || t === "radio") i.removeAttribute("checked");
      else if (!["submit", "button", "image", "reset"].includes(t)) i.setAttribute("value", "");
    });
    clone.querySelectorAll("textarea").forEach((t) => { t.textContent = ""; });
    clone.querySelectorAll("option").forEach((o) => o.removeAttribute("selected"));
    let html = "<!doctype html>\n" + clone.outerHTML;
    for (const val of collectPii(profile)) html = html.replace(new RegExp(escapeRegExp(val), "gi"), "[REDACTED]");
    return html;
  }

  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function mountDevTools(panel, adapter) {
    const ats = slugify(adapter.name) || "generic";
    const dev = el(`<div class="dev" title="Dev only: capture this page as a test fixture"><input class="step" type="text" placeholder="step (e.g. page1)" spellcheck="false"><button class="export">Export DOM</button></div>`);
    const msg = el(`<div class="dev-msg"></div>`);
    panel.querySelector(".foot").before(dev, msg);
    dev.querySelector(".export").addEventListener("click", async () => {
      const step = slugify(dev.querySelector(".step").value) || "capture";
      const profile = await AvidAutofill.getProfile();
      download(`${ats}-${step}.html`, buildFixtureHtml(profile));
      msg.textContent = `Saved ${ats}-${step}.html. Move it into test/fixtures.`;
    });
  }

  AvidAutofill.widget = { mount, open: () => openDrawer ? openDrawer() : false };
  AvidAutofill.isDevBuild = isDevBuild;
})();
