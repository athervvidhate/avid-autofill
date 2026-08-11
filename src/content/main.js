// Content-script entry point. On a supported job site, mount the in-page widget.
// Also answers the toolbar popup's AVID_FILL message so both entry points work
// against the same engine. Runs in every matched frame (all_frames), so an ATS
// embedded in an iframe gets the widget too.
(function () {
  const g = globalThis;
  // Guard against double-injection: on a declared ATS site the content scripts
  // already ran, and the popup's activeTab fallback may inject them again. Only
  // main.js has side effects (mount + listener), so a single flag here is enough.
  if (g.__avidAutofillMainLoaded) return;
  g.__avidAutofillMainLoaded = true;

  const AvidAutofill = g.AvidAutofill;

  // Mount the floating widget when we recognize the ATS (skip unknown pages,
  // including local dev files that aren't the sample form).
  function init() {
    const adapter = AvidAutofill.adapters.detect();
    if (adapter.name !== "Generic") {
      AvidAutofill.widget.mount(adapter);
    } else if (document.querySelector("form")) {
      // Unrecognized but has a form (e.g. the local test fixture): still offer it.
      AvidAutofill.widget.mount(adapter);
    }
  }
  if ("requestIdleCallback" in window) requestIdleCallback(init, { timeout: 2000 });
  else setTimeout(init, 800);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "AVID_FILL") {
      (async () => {
        try {
          const profile = await AvidAutofill.getProfile();
          const settings = await AvidAutofill.getSettings();
          const resume = await AvidAutofill.getResume();
          const report = await AvidAutofill.engine.fillPage(profile, settings, resume);
          sendResponse({ ok: true, report });
        } catch (err) {
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        }
      })();
      return true; // keep the channel open for the async response
    }
  });
})();
