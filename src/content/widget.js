// Page-mounted drawer for supported job applications.
// It lives in a shadow root so employer page styles cannot affect it.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  if (AvidAutofill.widget) return;

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
    const attach = () => {
      if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
    };
    attach();
    // Watch the document as well as its root, since hydration can replace either.
    const observer = new MutationObserver(attach);
    observer.observe(document, { childList: true, subtree: true });

    const atsLabel = adapter.beta ? `${adapter.name} (beta)` : adapter.name;
    const fillLabel = adapter.name === "Generic" ? "Try filling this page" : "Fill this application";
    AvidAutofill.loadWidgetFonts?.();
    root.appendChild(el(`<style>${AvidAutofill.widgetStyle || ""}</style>`));
    // Store builds report problems; local builds capture fixtures instead (mountDevTools).
    const canReport = !isDevBuild() && !!AvidAutofill.report;
    let lastFillReport = null;
    const wrap = el(`<div class="wrap"></div>`);
    const launcher = el(`<button class="launcher" hidden aria-label="Open Avid Autofill">Open Avid</button>`);
    const panel = el(`
      <section class="panel" role="dialog" aria-label="Avid Autofill" aria-modal="false">
        <header class="top">
          <div class="brand"><span class="mark" aria-hidden="true">A</span><div class="titles"><b>Avid Autofill</b><span class="eyebrow">${atsLabel}</span></div></div>
          <button class="icon-button collapse" aria-label="Collapse Avid Autofill">›</button>
        </header>
        <div class="tabs" role="tablist" aria-label="Avid tools">
          <button class="tab fill-tab" id="avid-fill-tab" type="button" role="tab" aria-controls="avid-fill-view" aria-selected="true">Autofill</button>
          <button class="tab copy-tab" id="avid-copy-tab" type="button" role="tab" aria-controls="avid-copy-view" aria-selected="false">Copy info</button>
        </div>
        <div class="fill-view" id="avid-fill-view" role="tabpanel" aria-labelledby="avid-fill-tab">
          <section class="intro">
            <span class="eyebrow">Use your saved profile</span>
            <span class="status" aria-live="polite"></span>
            <h1>Ready to fill your application</h1>
            <p>Use your saved profile to fill matching fields. You review everything before submitting.</p>
            <button class="primary fill">Fill this application</button>
            <button class="track" type="button">Track application</button>
            <details class="preferences">
              <summary>Fill preferences</summary>
              <div class="toggles">
                <label><input type="checkbox" class="ov" /> <span>Replace fields that already have a value</span></label>
                <label><input type="checkbox" class="eeo" /> <span>Fill voluntary self-ID questions</span></label>
                <label><input type="checkbox" class="skills" /> <span>Add skills to skills sections</span></label>
              </div>
            </details>
          </section>
          <section class="ledger">
            <div class="summary" hidden role="status" aria-live="polite"></div>
            <div class="results"></div>
          </section>
        </div>
        <section class="copy-view" id="avid-copy-view" role="tabpanel" aria-labelledby="avid-copy-tab" hidden>
          <h1>Copy your saved info</h1>
          <p class="copy-help">Copy a field, then paste it into the application. These are the values Avid uses to fill forms.</p>
          <p class="copy-status" role="status" aria-live="polite"></p>
          <div class="copy-groups"></div>
        </section>
        <section class="report-view" id="avid-report-view" aria-labelledby="avid-report-title" hidden>
          <div class="report-scroll">
          <h1 id="avid-report-title">Report a problem</h1>
          <p class="copy-help">This sends the developer the page so the problem can be fixed. Nothing is sent until you attach the saved file to the email yourself. Your saved profile details, anything you typed into the form, and hidden form values are removed first.</p>
          <label class="report-label" for="avid-report-note">What went wrong? (optional)</label>
          <textarea class="report-note" id="avid-report-note" rows="3" maxlength="500"></textarea>
          <dl class="report-facts"></dl>
          <details class="report-file">
            <summary>View the full file</summary>
            <pre class="report-preview" tabindex="0"></pre>
          </details>
          <p class="copy-status report-status" role="status" aria-live="polite"></p>
          </div>
          <div class="report-actions"><button class="primary report-send" type="button">Save report and open email</button><button class="report-cancel" type="button">Cancel</button></div>
        </section>
        <footer class="foot"><button class="opt" type="button">Edit profile</button>${canReport ? `<button class="opt report-open" type="button">Report a problem</button>` : ""}<span class="review">Stored locally<br />Review before submitting</span></footer>
      </section>
    `);
    wrap.append(panel, launcher);
    root.appendChild(wrap);

    const $ = (selector) => panel.querySelector(selector);
    const sectionNames = {
      personal: "Personal", links: "Links and portfolio", work: "Experience",
      education: "Education", workAuth: "Work authorization", misc: "Other details",
      questions: "Application answers", eeo: "Voluntary self-ID",
    };
    const fieldNames = { linkedin: "LinkedIn", github: "GitHub", gpa: "GPA", phoneDeviceType: "Phone device type", howHeard: "How did you hear about us?" };
    const fieldName = (key) => fieldNames[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
    const fieldValue = (value) => typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "");

    function makeCopyField(label, value) {
      const field = document.createElement("div");
      field.className = "copy-field";
      const head = document.createElement("div");
      head.className = "copy-field-head";
      const name = document.createElement("b");
      name.textContent = label;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Copy";
      button.setAttribute("aria-label", `Copy ${label}`);
      button.addEventListener("click", async () => {
        try {
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
            await navigator.clipboard.writeText(value);
          } catch (_) {
            const input = document.createElement("textarea");
            input.value = value;
            input.style.cssText = "position:fixed;left:-9999px";
            root.append(input);
            input.select();
            let copied;
            try { copied = document.execCommand("copy"); }
            finally { input.remove(); button.focus(); }
            if (!copied) throw new Error("Copy failed");
          }
          $(".copy-status").textContent = `Copied ${label}`;
        } catch (_) {
          $(".copy-status").textContent = `Could not copy ${label}. Select the text below and copy it manually.`;
        }
      });
      const text = document.createElement("p");
      text.textContent = value;
      head.append(name, button);
      field.append(head, text);
      return field;
    }

    async function renderCopy() {
      const profile = await AvidAutofill.getProfile();
      const groups = $(".copy-groups");
      groups.replaceChildren();
      for (const [section, title] of Object.entries(sectionNames)) {
        const data = profile[section];
        const group = document.createElement("div");
        group.className = "copy-group";
        const heading = document.createElement("h2");
        heading.textContent = title;
        group.append(heading);
        const entries = Array.isArray(data) ? data : [data];
        entries.forEach((entry, index) => {
          if (!entry || typeof entry !== "object") return;
          const item = document.createElement("div");
          item.className = "copy-item";
          if (Array.isArray(data)) {
            const itemHeading = document.createElement("h3");
            itemHeading.textContent = section === "work"
              ? [entry.title, entry.company].filter(Boolean).join(" at ") || `Role ${index + 1}`
              : [entry.degree, entry.school].filter(Boolean).join(" at ") || `School ${index + 1}`;
            item.append(itemHeading);
          }
          // Roles list company, role name, then description first; the rest keep their order.
          const lead = section === "work" ? ["company", "title", "description"] : [];
          const ordered = Object.entries(entry).sort(([a], [b]) => {
            const rank = (key) => lead.includes(key) ? lead.indexOf(key) : lead.length;
            return rank(a) - rank(b);
          });
          for (const [key, raw] of ordered) {
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              for (const [question, answer] of Object.entries(raw)) {
                if (answer !== "" && answer != null) item.append(makeCopyField(question, fieldValue(answer)));
              }
            } else if (raw !== "" && raw != null && (!Array.isArray(raw) || raw.length)) {
              item.append(makeCopyField(fieldName(key), Array.isArray(raw) ? raw.join(", ") : fieldValue(raw)));
            }
          }
          if (item.querySelector(".copy-field")) group.append(item);
        });
        if (group.querySelector(".copy-item")) groups.append(group);
      }
      if (!groups.children.length) groups.textContent = "No saved details yet. Use Edit profile to add them.";
    }

    function showView(view) {
      const copying = view === "copy", reporting = view === "report";
      $(".fill-view").hidden = copying || reporting;
      $(".copy-view").hidden = !copying;
      $(".report-view").hidden = !reporting;
      $(".tabs").hidden = reporting;
      $(".foot").hidden = reporting;
      $(".fill-tab").setAttribute("aria-selected", String(!copying));
      $(".copy-tab").setAttribute("aria-selected", String(copying));
      $(".fill-tab").tabIndex = copying ? -1 : 0;
      $(".copy-tab").tabIndex = copying ? 0 : -1;
      if (copying) renderCopy();
    }
    $(".copy-tab").tabIndex = -1;
    $(".fill-tab").addEventListener("click", () => showView("fill"));
    $(".copy-tab").addEventListener("click", () => showView("copy"));
    $(".tabs").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "fill" : event.key === "End" ? "copy"
        : $(".fill-tab").getAttribute("aria-selected") === "true" ? "copy" : "fill";
      showView(next);
      $(next === "copy" ? ".copy-tab" : ".fill-tab").focus();
    });
    const setOpen = (value) => {
      panel.hidden = !value;
      launcher.hidden = value;
      launcher.setAttribute("aria-expanded", String(value));
      panel.setAttribute("aria-hidden", String(!value));
      if (value) {
        syncToggles();
        if (!$(".copy-view").hidden) renderCopy();
      }
    };
    openDrawer = () => { attach(); setOpen(true); return host.isConnected; };
    setOpen(true);

    if (adapter.name === "Generic") {
      $(".status").className = "status warn";
      $(".status").innerHTML = `<i class="status-dot"></i> Generic form`;
      $(".intro h1").textContent = "Check this page before filling";
      $(".intro p").textContent = "Avid did not recognize this site. You can try matching fields, then review every result.";
      $(".fill").textContent = "Try filling this page";
    }

    launcher.addEventListener("click", () => { setOpen(true); $(".collapse").focus(); });
    $(".collapse").addEventListener("click", () => { setOpen(false); launcher.focus(); });
    $(".opt").addEventListener("click", () => chrome.runtime.sendMessage({ type: "AVID_OPEN_OPTIONS" }));
    $(".track").addEventListener("click", () => AvidAutofill.tracker?.open());
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) { setOpen(false); launcher.focus(); }
    });

    async function syncToggles() {
      const s = await AvidAutofill.getSettings();
      $(".ov").checked = s.overwriteFilled;
      $(".eeo").checked = s.fillEEO;
      $(".skills").checked = s.fillSkills !== false;
    }
    async function persistToggles() {
      const s = await AvidAutofill.getSettings();
      s.overwriteFilled = $(".ov").checked;
      s.fillEEO = $(".eeo").checked;
      s.fillSkills = $(".skills").checked;
      await AvidAutofill.saveSettings(s);
    }
    $(".ov").addEventListener("change", persistToggles);
    $(".eeo").addEventListener("change", persistToggles);
    $(".skills").addEventListener("change", persistToggles);

    if (isDevBuild()) mountDevTools(panel, adapter);
    if (canReport) mountReport();

    function mountReport() {
      // The page is scrubbed once per open: cloning and scanning it on every keystroke made typing lag.
      let built = null, html = "", fileHead = "", fileBody = "";
      const status = $(".report-status"), note = $(".report-note"), facts = $(".report-facts"), preview = $(".report-preview");
      const PREVIEW_CHARS = 20000;
      const rebuild = (profile) => {
        built = AvidAutofill.report.buildReport({ adapter, profile, fillReport: lastFillReport, note: note.value, html });
        facts.replaceChildren(...built.facts.filter(([key]) => key !== "What went wrong").flatMap(([key, value]) => {
          const dt = document.createElement("dt"), dd = document.createElement("dd");
          dt.textContent = key; dd.textContent = value;
          return [dt, dd];
        }));
        fileHead = built.header;
        if (preview.textContent) preview.textContent = fileHead + fileBody;
      };
      $(".report-open").addEventListener("click", async () => {
        status.textContent = "";
        showView("report");
        const profile = await AvidAutofill.getProfile();
        html = AvidAutofill.report.scrubbedHtml(profile, { strict: true });
        rebuild(profile);
        // A very large page is shown in part so the drawer stays responsive; the saved file has all of it.
        fileBody = html.length > PREVIEW_CHARS
          ? `${html.slice(0, PREVIEW_CHARS)}\n\n... ${Math.round((html.length - PREVIEW_CHARS) / 1000)} KB more of page HTML, scrubbed the same way, is in the saved file.`
          : html;
        preview.textContent = fileHead + fileBody;
        note.focus();
      });
      note.addEventListener("input", () => { if (built) rebuild(); });
      $(".report-cancel").addEventListener("click", () => { showView("fill"); $(".report-open").focus(); });
      $(".report-send").addEventListener("click", async () => {
        try {
          const blob = new Blob([built.text], { type: "text/html" });
          const save = document.createElement("a");
          save.href = URL.createObjectURL(blob); save.download = built.filename; save.click();
          setTimeout(() => URL.revokeObjectURL(save.href), 1000);
          const mail = document.createElement("a");
          mail.href = AvidAutofill.report.reportLink({ subject: built.subject, filename: built.filename, header: built.header });
          mail.target = "_blank"; mail.rel = "noopener";
          mail.click();
          status.textContent = `Saved ${built.filename}. In the message that opened, attach that file and send it.`;
        } catch (error) { status.textContent = explain(error); }
      });
    }

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
        lastFillReport = report;
        renderReport($, report);
      } catch (err) {
        renderError($, explain(err));
      } finally {
        btn.disabled = false;
        btn.textContent = fillLabel;
      }
    });
  }

  // After the extension reloads, this page's copy of Avid can no longer reach it.
  function explain(error) {
    const message = String((error && error.message) || error);
    return /context invalidated/i.test(message) ? "Avid was updated. Refresh this page to use it; answers you typed here are not saved." : message;
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
    if (!report.blocked && !report.results.length) {
      $(".status").className = "status warn";
      $(".status").textContent = "No matching fields";
      summary.textContent = "Nothing was filled. Check that the application form is open and has finished loading.";
      $(".results").innerHTML = "";
      return;
    }
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
    if (report.aiMessage) {
      const notice = document.createElement("p");
      notice.className = "notice";
      notice.textContent = report.aiMessage;
      summary.append(notice);
    }
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
      label.title = r.label;
      const value = document.createElement("span");
      value.className = "result-value";
      value.textContent = completed ? r.value : r.status === "assumed" ? `Assumed: ${r.value}` : statusLabel(r.status);
      value.title = `${r.value || ""} · ${statusLabel(r.status)}${r.method === "jev" ? ` · Jev: ${r.reason || "saved answer"}` : ""}`;
      li.append(rail, label, value);
      if (r.field && AvidAutofill.jevContent && AvidAutofill.jevContent.answerFor(r.field)) addSave(li, r.field, r.label);
      list.append(li);
    }
    group.append(list);
    host.append(group);
  }

  // Save the answer the applicant gave on the page to the question bank, so
  // Jev can reuse it. Only real clicks count: the page can reach this open
  // shadow root and must not plant answers.
  function addSave(li, fieldId, label) {
    const jev = AvidAutofill.jevContent;
    const button = el(`<button class="save-answer" type="button">Save</button>`);
    const panel = el(`<div class="save-panel" hidden></div>`);
    li.classList.add("saveable");
    li.append(button, panel);
    const show = (text) => { panel.hidden = false; panel.textContent = text; };
    button.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      const current = jev.answerFor(fieldId);
      if (!current || !current.answer) return show("Answer this on the page, then save it.");
      panel.hidden = false;
      panel.innerHTML = `<span class="save-prompt"></span><span class="save-choices"><button type="button" class="scope-company">This company</button><button type="button" class="scope-any">Any application</button></span>`;
      panel.querySelector(".save-prompt").textContent = `Save “${current.answer}” for “${label}”:`;
      for (const [selector, anySite] of [[".scope-company", false], [".scope-any", true]]) {
        panel.querySelector(selector).addEventListener("click", async (choice) => {
          if (!choice.isTrusted) return;
          try {
            await jev.saveAnswer(fieldId, current.answer, anySite);
            button.remove();
            li.querySelector(".result-value").textContent = "Saved to bank";
            show(anySite ? "Saved. Jev can reuse it on any application." : "Saved. Jev can reuse it on this company's applications.");
          } catch (error) { show(explain(error)); }
        });
      }
    });
  }

  function statusLabel(status) {
    return ({ "kept-existing": "Kept existing", skipped: "Skipped", "no-option-match": "No match", error: "Error", assumed: "Assumed answer", "ai-needs-answer": "Needs your answer", "ai-incompatible": "Value does not fit", "ai-unavailable": "Jev unavailable", "ai-stale": "Page or profile changed", "ai-limit": "Fill again for more" })[status] || status;
  }

  // --- Dev-only fixture capture -------------------------------------------
  function isDevBuild() {
    try { return !("update_url" in chrome.runtime.getManifest()); }
    catch (_) { return false; }
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
      download(`${ats}-${step}.html`, AvidAutofill.report.scrubbedHtml(profile));
      msg.textContent = `Saved ${ats}-${step}.html. Move it into test/fixtures.`;
    });
  }

  AvidAutofill.widget = { mount, open: () => openDrawer ? openDrawer() : false };
  AvidAutofill.isDevBuild = isDevBuild;
})();
