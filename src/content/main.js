// Content-script entry point. On a supported job site, mount the page drawer.
// Runs in every matched frame (all_frames), so an ATS embedded in an iframe can
// still receive the drawer and fill message.
(function () {
  const g = globalThis;
  // Guard against double-injection: the toolbar action can inject the same files
  // on a page where the manifest already loaded them. Only main.js has side
  // effects, so a single flag here is enough.
  if (g.__avidAutofillMainLoaded) return;
  g.__avidAutofillMainLoaded = true;

  const AvidAutofill = g.AvidAutofill;

  // Mount the drawer when we recognize the ATS. A toolbar click can also ask us
  // to mount on an unrecognized page so the user can see its status.
  function init() {
    const adapter = AvidAutofill.adapters.detect();
    if (adapter.name === "iCIMS" && window.parent !== window) return;
    if (adapter.name === "iCIMS" && document.querySelector("iframe#icims_content_iframe")) {
      AvidAutofill.engine.fillPage = async () => {
        const response = await chrome.runtime.sendMessage({ type: "AVID_FILL_ICIMS_FRAME" });
        if (!response?.ok) throw new Error(response?.error || "Avid could not reach the iCIMS form.");
        return response.report;
      };
    }
    const requested = !!g.__avidOpenDrawer;
    if (adapter.name !== "Generic" || document.querySelector("form") || requested) {
      AvidAutofill.widget.mount(adapter);
      if (requested) {
        delete g.__avidOpenDrawer;
        AvidAutofill.widget.open();
      }
    }
  }
  if ("requestIdleCallback" in window) requestIdleCallback(init, { timeout: 2000 });
  else setTimeout(init, 800);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "AVID_OPEN_DRAWER") {
      AvidAutofill.widget.open();
      return false;
    }
    if (msg && (msg.type === "AVID_FILL" || (msg.type === "AVID_FILL_ICIMS_FRAME" && window.parent !== window))) {
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
