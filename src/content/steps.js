// Fills each application page as it appears, so the applicant does not click
// Fill on every step. Nothing fills until the applicant has clicked Fill once in
// this tab; that click arms it for the rest of the application. Watches for a set of fillable fields it has not filled yet
// (a Next click, a route change, a section that opens) and runs one fill for it.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  if (AvidAutofill.steps) return;

  const QUIET_MS = 1200; // wait for the page to stop changing before reading it
  const WINDOW_MS = 12000; // how long a step change is watched before giving up
  const MAX_RUNS = 25;
  const FIELDS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]), select, textarea, [role="combobox"]';

  const filled = new Set(); // keys of fields already given a fill pass
  const FLAG = "avidStepsArmed";
  let started = false;
  let armed = false;
  let running = false;
  let runs = 0;
  let timer = null;
  let lastUrl = location.href;

  const wasArmed = () => {
    try { return armed || sessionStorage.getItem(FLAG) === "1"; } catch (_) { return armed; }
  };

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
    if (!wasArmed() || running || runs >= MAX_RUNS || document.visibilityState === "hidden") return;
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
    }
  }

  // After a step change, wait for the page to stop changing, then fill once. The
  // page is only watched for a short window, so a form that keeps redrawing
  // itself later never triggers a fill the applicant did not ask for.
  let observer = null;
  let windowTimer = null;
  function settle() {
    if (!wasArmed() || running) return;
    const quiet = () => {
      clearTimeout(timer);
      // Nothing new yet means the next page is still loading: keep watching.
      timer = setTimeout(() => { if (freshFields().length) { stopWatching(); maybeFill(); } }, QUIET_MS);
    };
    if (!observer) {
      observer = new MutationObserver(quiet);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      windowTimer = setTimeout(stopWatching, WINDOW_MS);
    }
    quiet();
  }
  function stopWatching() {
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(windowTimer);
    clearTimeout(timer);
  }

  const NEXT = /^(save( and| &|,)? ?(continue|next)|save|next|next step|continue|continue to .*|proceed|go to next.*|forward|apply now|start application)$/i;
  const NOT_NEXT = /\b(back|previous|cancel|delete|remove|discard|sign out|log ?out)\b/i;
  function onClick(event) {
    const t = event.target && event.target.closest && event.target.closest('button, a, input[type="submit"], input[type="button"], [role="button"]');
    if (!t || t.closest("#avid-autofill-root")) return;
    const label = String(t.textContent || t.value || t.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    if (label.length > 40 || NOT_NEXT.test(label) || !NEXT.test(label)) return;
    settle();
  }

  function start(fillNow = true) {
    if (started) return;
    started = true;
    document.addEventListener("click", onClick, true);
    // Single-page apps change the URL without a load.
    setInterval(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; settle(); }
    }, 1000);
    window.addEventListener("popstate", settle);
    window.addEventListener("hashchange", settle);
    // A full page load after the applicant already armed it: fill the new page.
    if (fillNow && wasArmed()) settle();
  }

  // Called after the applicant's own Fill click: this page counts as done, and
  // every later step fills by itself.
  function arm() {
    armed = true;
    try { sessionStorage.setItem(FLAG, "1"); } catch (_) { /* private mode */ }
    freshFields().forEach((k) => filled.add(k));
    start(false);
  }

  AvidAutofill.steps = { start, arm, _freshFields: freshFields, _reset: () => { filled.clear(); runs = 0; }, _onClick: onClick, _settle: settle };
})();
