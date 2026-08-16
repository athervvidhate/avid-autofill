// Workday-specific widgets that the generic engine can't handle: the typeable
// MM/DD/YYYY date sections. (Workday text inputs and button-listbox dropdowns are
// handled by the generic passes once signals are de-camelCased — see matcher.js
// and fillers.setReactSelect.) Loaded before engine.js.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
    august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
    oct: 10, nov: 11, dec: 12,
  };

  // Parse "March 2027", "August 11, 2026", "03/2027", "2027-03-01", "Jun 2025"
  // into { mm, dd, yyyy } strings. dd is "" when the date is month/year only.
  function parseDate(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    let mm = "", dd = "", yyyy = "";

    const nameMatch = s.match(/([a-z]+)\s*\.?\s*(\d{1,2})?(?:,)?\s*(\d{4})/i);
    if (nameMatch && MONTHS[nameMatch[1].toLowerCase()]) {
      mm = String(MONTHS[nameMatch[1].toLowerCase()]);
      dd = nameMatch[2] || "";
      yyyy = nameMatch[3];
    } else {
      const iso = s.match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
      const us = s.match(/(\d{1,2})\/(?:(\d{1,2})\/)?(\d{4})/);
      if (iso) {
        yyyy = iso[1]; mm = String(+iso[2]); dd = iso[3] ? String(+iso[3]) : "";
      } else if (us) {
        mm = String(+us[1]); dd = us[2] ? String(+us[2]) : ""; yyyy = us[3];
      }
    }
    if (!yyyy || !mm) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return { mm: pad(mm), dd: dd ? pad(dd) : "", yyyy };
  }

  // Blur a date section once, after its whole MM/DD/YYYY has been entered, so
  // Workday's on-blur validation sees a complete value instead of erroring on a
  // half-filled date. Called on the last section filled.
  function blurDate(el) {
    if (!el) return;
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.blur();
  }

  // Fill every typeable date section on the page that maps to a profile value.
  // `handled` (optional) is the engine's shared WeakSet — sections whose month
  // input is already in it (e.g. filled per-panel by workExperiencePass) are
  // skipped so this generic sweep can't clobber them with the wrong value.
  async function datePass(profile, ctx) {
    const { matcher, helpers, fillers, record, handled } = ctx;
    const sections = document.querySelectorAll(
      '[data-automation-id="dateInputWrapper"], [data-automation-id="dateWidget"], [data-automation-id^="formField-"]'
    );
    const seen = new Set();
    for (const sec of sections) {
      const month = sec.querySelector('input[data-automation-id="dateSectionMonth-input"]');
      const year = sec.querySelector('input[data-automation-id="dateSectionYear-input"]');
      const day = sec.querySelector('input[data-automation-id="dateSectionDay-input"]');
      if (!month || !year || seen.has(month)) continue;
      if (handled && handled.has(month)) continue;
      seen.add(month);

      const signal = matcher.signalFor(sec);
      const m = matcher.match(signal, profile, helpers);
      if (!m) continue;
      const d = parseDate(m.value);
      if (!d) {
        record(signal, m.value, "date-unparsed");
        continue;
      }
      fillers.setDateSpinner(month, d.mm);
      if (day && d.dd) fillers.setDateSpinner(day, d.dd);
      fillers.setDateSpinner(year, d.yyyy);
      blurDate(year);
      record(signal, `${d.mm}/${d.dd || "--"}/${d.yyyy}`, "filled");
    }
  }

  // --- Work-experience repeater ----------------------------------------------
  // Workday's "My Experience" step renders one work-history panel by default and
  // grows via an "Add Another" button. That button shares its automation-id
  // ("add-button") with the Education repeater lower on the same page, so it
  // must be queried *within* the work-experience section, not page-wide.
  //
  // Panels are `[role="group"][aria-labelledby="Work-Experience-N-panel"]`
  // wrappers, where N is Workday's own 1-based panel counter — that's the index
  // we map to profile.work[N-1]. (Each field inside a panel also carries a
  // data-fkit-id="workExperience-<id>--<field>", but <id> is a random per-panel
  // instance token, not sequential, so it can't be used to order panels — only
  // to confirm a field belongs to *some* single panel.) Fields are looked up by
  // their formField-* automation-id scoped to the panel container, so panel 2's
  // "Job Title" input can never collide with panel 1's.
  const WORK_SECTION_SELECTOR = '[role="group"][aria-labelledby="Work-Experience-section"]';
  const WORK_PANEL_SELECTOR =
    '[role="group"][aria-labelledby^="Work-Experience-"][aria-labelledby$="-panel"]';

  // True when `el` lives inside a work-experience panel. workExperiencePass owns
  // every field in those panels (title/company/location/description/dates/current),
  // so the engine's generic passes must skip them: the generic matcher's
  // "job title" rule maps to profile.work[0].title, which would otherwise stamp
  // the first job's title onto every panel (each panel has its own "Job Title"
  // input). Relying on the `handled` WeakSet alone is not enough — Workday
  // re-renders panels during the add-loop, replacing the exact input nodes the
  // set was keyed on — so ownership is enforced structurally here instead.
  function isWorkExperienceField(el) {
    return !!(el && el.closest && el.closest(WORK_PANEL_SELECTOR));
  }

  function panelField(panel, fieldId) {
    const wrap = panel.querySelector(`[data-automation-id="formField-${fieldId}"]`);
    return wrap && wrap.querySelector("input, textarea");
  }

  function fillPanelText(panel, fieldId, value, fillers, handled, record, label) {
    if (!value) return;
    const el = panelField(panel, fieldId);
    if (!el || handled.has(el)) return;
    handled.add(el);
    fillers.setTextValue(el, value);
    record(label, value, "filled");
  }

  function fillPanelDate(panel, fieldId, rawDate, fillers, handled, record, label) {
    if (!rawDate) return;
    const wrap = panel.querySelector(`[data-automation-id="formField-${fieldId}"]`);
    const month = wrap && wrap.querySelector('input[data-automation-id="dateSectionMonth-input"]');
    const year = wrap && wrap.querySelector('input[data-automation-id="dateSectionYear-input"]');
    const day = wrap && wrap.querySelector('input[data-automation-id="dateSectionDay-input"]');
    if (!month || !year || handled.has(month)) return;
    handled.add(month);
    handled.add(year);
    if (day) handled.add(day);
    const d = parseDate(rawDate);
    if (!d) {
      record(label, rawDate, "date-unparsed");
      return;
    }
    fillers.setDateSpinner(month, d.mm);
    if (day && d.dd) fillers.setDateSpinner(day, d.dd);
    fillers.setDateSpinner(year, d.yyyy);
    blurDate(year);
    record(label, `${d.mm}/${d.dd || "--"}/${d.yyyy}`, "filled");
  }

  // Click "Add Another" until there is one panel per profile.work[] entry, then
  // fill each panel from its matching work entry, scoped to that panel's own
  // container so entries never bleed into each other.
  //
  // LIVE-VERIFY: clicking "Add Another" re-renders the section asynchronously
  // (React), so the panel list and button are re-queried fresh each iteration
  // rather than cached, with a settle delay between clicks. jsdom has no React
  // runtime, so clicking is a no-op there and this loop degrades gracefully
  // (it gives up after work.length + 2 attempts) — the captured fixture only
  // ever has Workday's single default panel, so the actual multi-panel growth
  // needs verifying against a live Workday application with 2+ work entries.
  async function workExperiencePass(profile, ctx) {
    const { fillers, record, handled } = ctx;
    const work = profile.work || [];
    if (!work.length) return;
    if (!document.querySelector(WORK_SECTION_SELECTOR)) return;

    for (let guard = 0; guard < work.length + 2; guard++) {
      const section = document.querySelector(WORK_SECTION_SELECTOR);
      if (!section) break;
      if (section.querySelectorAll(WORK_PANEL_SELECTOR).length >= work.length) break;
      const addBtn = section.querySelector('button[data-automation-id="add-button"]');
      if (!addBtn) break;
      addBtn.click();
      await fillers.sleep(400);
    }

    const section = document.querySelector(WORK_SECTION_SELECTOR);
    if (!section) return;
    const panels = section.querySelectorAll(WORK_PANEL_SELECTOR);

    panels.forEach((panel, i) => {
      const entry = work[i];
      if (!entry) return;
      const tag = `Work ${i + 1}`;
      fillPanelText(panel, "jobTitle", entry.title, fillers, handled, record, `${tag} - Job Title`);
      fillPanelText(panel, "companyName", entry.company, fillers, handled, record, `${tag} - Company`);
      fillPanelText(panel, "location", entry.location, fillers, handled, record, `${tag} - Location`);
      fillPanelText(panel, "roleDescription", entry.description, fillers, handled, record, `${tag} - Description`);
      fillPanelDate(panel, "startDate", entry.startDate, fillers, handled, record, `${tag} - Start Date`);

      const currentBox = panelField(panel, "currentlyWorkHere");
      if (entry.current && currentBox && !handled.has(currentBox)) {
        handled.add(currentBox);
        fillers.setCheckbox(currentBox, true);
        record(`${tag} - Currently Work Here`, "Yes", "checked");
      } else if (entry.endDate) {
        fillPanelDate(panel, "endDate", entry.endDate, fillers, handled, record, `${tag} - End Date`);
      }
    });
  }

  AvidAutofill.workday = { parseDate, datePass, workExperiencePass, isWorkExperienceField };
})();
