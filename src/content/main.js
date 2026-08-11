// Content-script entry point. Listens for messages from the popup and runs the
// engine against the current page.
(function () {
  const AvidAutofill = globalThis.AvidAutofill;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "AVID_PING") {
      const adapter = AvidAutofill.adapters.detect();
      sendResponse({ ok: true, ats: adapter.name, beta: !!(adapter.beta || adapter.stub) });
      return true;
    }
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
      return true; // keep the message channel open for the async response
    }
  });
})();
