// Fills each application page as it appears, so the applicant does not click
// Fill on every step. Watches for a set of fillable fields it has not filled yet
// (a Next click, a route change, a section that opens) and runs one fill for it.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  if (AvidAutofill.steps) return;

  const QUIET_MS = 1200; // wait for the page to stop changing before reading it
  const MAX_RUNS = 25;
  const FIELDS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]), select, textarea, [role="combobox"]';

  const filled = new Set(); // keys of fields already given a fill pass
  let started = false;
  let running = false;
  let runs = 0;
  let timer = null;
  let lastUrl = location.href;

  const text = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 80);

  // A stable identity for a field that survives re-renders of the same step.
  function keyOf(el, index) {
    const label = AvidAutofill.labelTextFor ? AvidAutofill.labelTextFor(el) : "";
    const id = el.getAttribute("name") || el.id || el.getAttribute("data-automation-id") || "";
    return [el.tagName, el.type || el.getAttribute("role") || "", text(id), text(label || el.getAttribute("aria-label") || el.placeholder), id || label ? "" : index].join("|");
  }

  function emptyOf(el) {
    if (el.type === "checkbox" || el.type === "radio") return !el.checked;
    if (el.type === "file") return !(el.files && el.files.length);
    if (el.tagName === "SELECT") return !el.value || el.selectedIndex <= 0;
    return !String(el.value || "").trim();
  }

  // Keys of the empty, rendered fields on the page that have not had a fill pass.
  function freshFields() {
    const F = AvidAutofill.fillers;
    const out = [];
    F.queryAll(FIELDS).forEach((el, i) => {
      if (el.disabled || !F.isRendered(el) || el.closest("#avid-autofill-root")) return;
      if (el.getAttribute("aria-hidden") === "true") return;
      const key = keyOf(el, i);
      if (!filled.has(key) && emptyOf(el)) out.push(key);
    });
    return out;
  }

  async function maybeFill() {
    timer = null;
    if (running || runs >= MAX_RUNS || document.visibilityState === "hidden") return;
    let settings;
    try { settings = await AvidAutofill.getSettings(); } catch (_) { return; }
    if (settings.autoFillSteps === false) return;
    const fresh = freshFields();
    if (!fresh.length) return;
    running = true;
    runs += 1;
    // Mark first so a failed or partial run is not retried in a loop.
    fresh.forEach((k) => filled.add(k));
    try {
      const report = await AvidAutofill.widget.fill();
      // A Workday page asking for a click first is retried after the next one.
      if (report && report.blocked) fresh.forEach((k) => filled.delete(k));
    } catch (_) {
      /* the drawer shows the error */
    } finally {
      // Fields the fill revealed (State after Country) belong to this pass.
      freshFields().forEach((k) => filled.add(k));
      running = false;
      schedule();
    }
  }

  function schedule() {
    if (running) return;
    clearTimeout(timer);
    timer = setTimeout(maybeFill, QUIET_MS);
  }

  function start() {
    if (started) return;
    started = true;
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    // Single-page apps change the URL without a load; a fresh step may reuse the DOM.
    setInterval(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; schedule(); }
    }, 800);
    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
    schedule();
  }

  AvidAutofill.steps = { start, _freshFields: freshFields, _reset: () => { filled.clear(); runs = 0; } };
})();
