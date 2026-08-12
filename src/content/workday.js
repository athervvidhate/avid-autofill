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
  const MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];

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

  // Fill every typeable date section on the page that maps to a profile value.
  async function datePass(profile, ctx) {
    const { matcher, helpers, fillers, record } = ctx;
    const sections = document.querySelectorAll(
      '[data-automation-id="dateInputWrapper"], [data-automation-id="dateWidget"], [data-automation-id^="formField-"]'
    );
    const seen = new Set();
    for (const sec of sections) {
      const month = sec.querySelector('input[data-automation-id="dateSectionMonth-input"]');
      const year = sec.querySelector('input[data-automation-id="dateSectionYear-input"]');
      const day = sec.querySelector('input[data-automation-id="dateSectionDay-input"]');
      if (!month || !year || seen.has(month)) continue;
      seen.add(month);

      const signal = matcher.signalFor(sec);
      const m = matcher.match(signal, profile, helpers);
      if (!m) continue;
      const d = parseDate(m.value);
      if (!d) {
        record(signal, m.value, "date-unparsed");
        continue;
      }
      fillers.setTextValue(month, d.mm);
      if (day && d.dd) fillers.setTextValue(day, d.dd);
      fillers.setTextValue(year, d.yyyy);
      record(signal, `${d.mm}/${d.dd || "--"}/${d.yyyy}`, "filled");
    }
  }

  // Pure: how many clicks on which monthPicker spinner to get from the
  // popover's currently-displayed year to the target year. Extracted so the
  // spin math is unit-testable under jsdom, which can't drive the actual
  // click-open-spin interaction (see popoverDatePass below).
  function yearSpinPlan(currentYear, targetYear) {
    const diff = Number(targetYear) - Number(currentYear);
    return { direction: diff >= 0 ? "right" : "left", clicks: Math.abs(diff) };
  }

  // Second date-widget variant: a calendar-icon popover (dateIcon ->
  // monthPicker spinner + month grid), used instead of the typeable
  // dateSection inputs on some Workday postings.
  //
  // LIVE-VERIFY-ONLY: the popover's inner DOM (monthPickerLeftSpinner /
  // monthPickerRightSpinner / month cells) renders only after dateIcon is
  // clicked, so it never appears in a static page capture — every fixture we
  // inspected uses the typeable dateSection variant even where a dateIcon is
  // also present alongside it (datePass already handles those). This pass is
  // implemented against Workday's documented automation-ids and has not been
  // exercised against a live posting that actually renders the popover-only
  // variant; re-verify against a real posting before relying on it.
  async function popoverDatePass(profile, ctx) {
    const { matcher, helpers, fillers, record } = ctx;
    const icons = document.querySelectorAll('[data-automation-id="dateIcon"]');
    for (const icon of icons) {
      const wrapper =
        icon.closest('[data-automation-id="dateInputWrapper"], [data-automation-id^="formField-"]') ||
        icon.parentElement;
      if (!wrapper) continue;
      // Typeable dateSection inputs already handled by datePass — skip those.
      if (wrapper.querySelector('input[data-automation-id="dateSectionMonth-input"]')) continue;

      const signal = matcher.signalFor(wrapper);
      const m = matcher.match(signal, profile, helpers);
      if (!m) continue;
      const target = parseDate(m.value);
      if (!target) {
        record(signal, m.value, "date-unparsed");
        continue;
      }

      try {
        icon.click();
        await fillers.sleep(200);

        const left = document.querySelector('[data-automation-id="monthPickerLeftSpinner"]');
        const right = document.querySelector('[data-automation-id="monthPickerRightSpinner"]');
        if (!left || !right) {
          record(signal, m.value, "error");
          continue;
        }
        const panel = left.closest('[role="dialog"], [role="application"]') || left.parentElement;
        const yearNode = Array.from(panel.querySelectorAll("*")).find(
          (n) => n.children.length === 0 && /^\d{4}$/.test((n.textContent || "").trim())
        );
        const currentYear = yearNode ? Number(yearNode.textContent.trim()) : new Date().getFullYear();
        const plan = yearSpinPlan(currentYear, Number(target.yyyy));
        const spinner = plan.direction === "right" ? right : left;
        for (let i = 0; i < plan.clicks; i++) {
          spinner.click();
          await fillers.sleep(80);
        }

        const monthName = MONTH_NAMES[Number(target.mm) - 1];
        const monthCell = Array.from(
          panel.querySelectorAll('[role="button"], button, div, span')
        ).find((n) => n.children.length === 0 && (n.textContent || "").trim().toLowerCase() === monthName);
        if (!monthCell) {
          record(signal, m.value, "error");
          continue;
        }
        monthCell.click();
        record(signal, `${target.mm}/${target.dd || "--"}/${target.yyyy}`, "filled");
      } catch (_) {
        record(signal, m.value, "error");
      }
    }
  }

  AvidAutofill.workday = { parseDate, datePass, yearSpinPlan, popoverDatePass };
})();
