// Orchestration: discover fillable fields, match each to the profile, fill it,
// and return a per-field report the popup can display. Runs in the content-script
// world where chrome.storage and the DOM are both reachable.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  const F = () => AvidAutofill.fillers;
  const M = () => AvidAutofill.matcher;

  const isVisible = (el) =>
    el && el.offsetParent !== null && !el.disabled && el.type !== "hidden";

  const isAffirmative = (v) => /^(yes|y|true|1)$/i.test(String(v).trim());

  async function fillPage(profile, settings, resume) {
    AvidAutofill._highlight = settings.highlightFilled;
    const fillers = F();
    const matcher = M();
    const helpers = matcher.makeHelpers(profile);
    const adapter = AvidAutofill.adapters.detect();
    const handled = new WeakSet();
    const results = [];

    const record = (signal, value, status) =>
      results.push({ label: shorten(signal), value, status });

    // --- 0. Resume upload (if a resume is stored). ---
    if (resume) await uploadResume(resume, matcher, fillers, record);

    // Workday work-history repeater (Add Another + per-panel fill) runs before
    // the generic date sweep so its date sections are marked handled first and
    // can't be re-matched (and mis-mapped) by the page-wide date pass below.
    if (adapter.hasDateSections && AvidAutofill.workday) {
      if (AvidAutofill.workday.workExperiencePass) {
        await AvidAutofill.workday.workExperiencePass(profile, { fillers, record, handled });
      }
      // Workday typeable date sections (MM/DD/YYYY spinbuttons).
      await AvidAutofill.workday.datePass(profile, { matcher, helpers, fillers, record, handled });
    }

    // --- 1. Custom (react-select / combobox / Workday) dropdowns first, so their
    //        inner <input> is marked handled before the text pass sees it.
    //        Runs twice: selecting Country reveals the State dropdown, etc. ---
    async function dropdownPass() {
      const controls = [];
      for (const sel of adapter.customSelectSelectors || []) {
        document.querySelectorAll(sel).forEach((c) => controls.push(c));
      }
      for (const control of dedupe(controls)) {
        if (handled.has(control) || !isVisible(control)) continue;
        control.querySelectorAll("input").forEach((i) => handled.add(i));
        handled.add(control);
        const signal = matcher.signalFor(control);
        const m = matcher.match(signal, profile, helpers);
        if (!m) continue;
        if (m.eeo && !settings.fillEEO) continue;
        try {
          const ok = await fillers.setReactSelect(control, [m.value, ...(m.alts || [])]);
          record(signal, m.value, ok ? "filled" : "skipped");
        } catch (_) {
          record(signal, m.value, "error");
        }
      }
    }
    await dropdownPass();
    // Second pass catches dropdowns that only render after an earlier selection
    // (Workday's State appears once Country is chosen).
    await fillers.sleep(500);
    await dropdownPass();

    // --- 2. Radio groups (grouped by name). ---
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"]').forEach((r) => {
      if (!r.name) return;
      (radioGroups[r.name] = radioGroups[r.name] || []).push(r);
    });
    for (const name of Object.keys(radioGroups)) {
      const group = radioGroups[name].filter(isVisible);
      if (!group.length) continue;
      group.forEach((r) => handled.add(r));
      const signal = groupSignal(group[0]);
      const m = matcher.match(signal, profile, helpers);
      if (!m) continue;
      if (m.eeo && !settings.fillEEO) continue;
      const ok = fillers.setRadio(group, m.value);
      record(signal, m.value, ok ? "filled" : "skipped");
    }

    // --- 3. Everything else: text inputs, textareas, native selects, checkboxes.
    const nodes = document.querySelectorAll(
      'input, textarea, select'
    );
    for (const el of nodes) {
      if (handled.has(el)) continue;
      if (!isVisible(el)) continue;
      const type = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "file", "password", "image", "reset"].includes(type))
        continue;

      const signal = matcher.signalFor(el);
      const m = matcher.match(signal, profile, helpers);
      if (!m) continue;
      if (m.eeo && !settings.fillEEO) continue;

      // Respect existing content unless overwrite is on.
      const hasValue =
        (el.tagName === "SELECT" && el.value && el.selectedIndex > 0) ||
        (type === "checkbox" ? false : !!el.value);
      if (hasValue && !settings.overwriteFilled) {
        record(signal, m.value, "kept-existing");
        continue;
      }

      try {
        if (el.tagName === "SELECT") {
          const ok = fillers.setNativeSelect(el, [m.value, ...(m.alts || [])]);
          record(signal, m.value, ok ? "filled" : "no-option-match");
        } else if (type === "checkbox") {
          // Affirmative yes/no answers tick the box; negatives leave it.
          const want = m.kind === "yesno" ? isAffirmative(m.value) : true;
          fillers.setCheckbox(el, want);
          record(signal, want ? "checked" : "unchecked", "filled");
        } else {
          fillers.setTextValue(el, m.value);
          record(signal, m.value, "filled");
        }
      } catch (_) {
        record(signal, m.value, "error");
      }
    }

    return {
      ats: adapter.name,
      stub: !!adapter.stub,
      beta: !!(adapter.beta || adapter.stub),
      filledCount: results.filter((r) => r.status === "filled" || r.status === "checked").length,
      results,
    };
  }

  // Find the resume file input and inject the stored resume. File inputs are
  // often visually hidden behind a styled button, so we do NOT use the visible
  // check here — we score every enabled file input by how resume-like it looks.
  async function uploadResume(resume, matcher, fillers, record) {
    const inputs = Array.from(
      document.querySelectorAll('input[type="file"]')
    ).filter((i) => !i.disabled);

    const scored = inputs.map((i) => ({
      el: i,
      sig: (matcher.signalFor(i) + " " + (i.accept || "")).toLowerCase(),
    }));

    // Prefer inputs that mention resume/cv; skip ones clearly for something else.
    const isOther = (s) => /cover letter|photo|portfolio file|transcript/.test(s);
    let target =
      scored.find((s) => /resume|cv|curriculum vitae/.test(s.sig) && !isOther(s.sig)) ||
      (inputs.length === 1 ? scored[0] : null) ||
      scored.find((s) => /\.pdf|\.doc/.test(s.sig) && !isOther(s.sig));

    if (!target) {
      // Best-effort: a drag-drop zone labelled resume with no reachable input.
      const zone = Array.from(
        document.querySelectorAll('[class*="dropzone"], [class*="drop-zone"], [class*="upload"]')
      ).find((z) => /resume|cv|drag/i.test(z.textContent || ""));
      if (zone) {
        try {
          await fillers.dropOnZone(zone, resume);
          record("resume (drop zone)", resume.name, "filled");
        } catch (_) {
          record("resume (drop zone)", resume.name, "error");
        }
      }
      return;
    }

    try {
      await fillers.uploadToInput(target.el, resume);
      record("resume upload", resume.name, "filled");
    } catch (_) {
      record("resume upload", resume.name, "error");
    }
  }

  // Signal for a radio/checkbox group: prefer a fieldset legend, else nearby text.
  function groupSignal(el) {
    const fs = el.closest("fieldset");
    if (fs) {
      const legend = fs.querySelector("legend");
      if (legend) return M().norm(legend.textContent);
    }
    return M().signalFor(el);
  }

  function dedupe(arr) {
    return Array.from(new Set(arr));
  }
  function shorten(s) {
    const clean = s.split(" | ")[0] || s;
    return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
  }

  AvidAutofill.engine = { fillPage };
})();
