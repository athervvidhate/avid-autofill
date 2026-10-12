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
  let captured = false;
  function init() {
    const adapter = AvidAutofill.adapters.detect();
    if (adapter.name === "iCIMS" && window.parent !== window) {
      // The outer page's drawer fills this frame through the relay below. Later
      // steps of the form load inside this frame, so it watches for them itself.
      AvidAutofill.widget.fill = fillHere;
      if (AvidAutofill.steps) AvidAutofill.steps.start();
      return true;
    }
    const icimsHost = adapter.name === "iCIMS" && !!document.querySelector("iframe#icims_content_iframe");
    if (icimsHost) {
      AvidAutofill.engine.fillPage = async () => {
        const response = await chrome.runtime.sendMessage({ type: "AVID_FILL_ICIMS_FRAME" });
        if (!response?.ok) throw new Error(response?.error || "Avid could not reach the iCIMS form.");
        return response.report;
      };
    }
    if (!captured && AvidAutofill.workday && AvidAutofill.workday.captureDescription) AvidAutofill.workday.captureDescription().catch(() => {});
    captured = true;
    const requested = !!g.__avidOpenDrawer;
    // A company careers page wrapping the iCIMS form frame counts as iCIMS.
    const known = icimsHost || (adapter.name !== "Generic" && !AvidAutofill.adapters.markupOnly(adapter));
    if (known || requested || AvidAutofill.generic.detect().isApplication) {
      AvidAutofill.widget.mount(adapter);
      if (!requested && AvidAutofill.steps) AvidAutofill.steps.start();
      if (requested) {
        delete g.__avidOpenDrawer;
        AvidAutofill.widget.open();
      }
      return true;
    }
    return false;
  }

  // On an unfamiliar site the form often renders after load (single-page apps,
  // an Apply button that reveals it), so keep checking for a couple of minutes.
  function watch() {
    let timer;
    const stop = () => { observer.disconnect(); clearTimeout(timer); };
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (init()) stop(); }, 750);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(stop, 120000);
  }

  // The toolbar button asks for the drawer even when the page was not recognised
  // as an application and the watch above has already given up.
  AvidAutofill.openDrawer = () => {
    if (window !== window.top && !document.querySelector("input, select, textarea")) return false;
    // The iCIMS form frame is filled from the outer page's drawer, never its own.
    if (window !== window.top && AvidAutofill.adapters.detect().name === "iCIMS") return false;
    AvidAutofill.widget.mount(AvidAutofill.adapters.detect());
    return AvidAutofill.widget.open();
  };

  async function fillHere() {
    const profile = await AvidAutofill.getProfile();
    const settings = await AvidAutofill.getSettings();
    const resume = await AvidAutofill.getResume();
    return AvidAutofill.engine.fillPage(profile, settings, resume);
  }

  function start() { if (!init()) watch(); }
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 2000 });
  else setTimeout(start, 800);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "AVID_OPEN_DRAWER") {
      AvidAutofill.openDrawer();
      return false;
    }
    // The iCIMS relay reaches every frame in the tab. Only the iCIMS form frame
    // answers: an ad or tracker frame running this script on an any-site page
    // would otherwise answer first with an empty report.
    const icimsFrame = msg && msg.type === "AVID_FILL_ICIMS_FRAME" && window.parent !== window && /(^|\.)icims\.com$/.test(window.location.hostname);
    if (msg && (msg.type === "AVID_FILL" || icimsFrame)) {
      (async () => {
        try {
          const report = await fillHere();
          // The applicant's Fill on the outer page arms this frame's later steps.
          if (icimsFrame && AvidAutofill.steps) AvidAutofill.steps.arm();
          sendResponse({ ok: true, report });
        } catch (err) {
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        }
      })();
      return true; // keep the channel open for the async response
    }
  });
})();
