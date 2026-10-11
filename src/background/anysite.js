// Optional: run the autofill drawer on every site, not just known job platforms.
// The content script only shows the drawer when the page looks like a job
// application (AvidAutofill.generic.detect), so ordinary pages stay untouched.
(function () {
  const ID = "avid-autofill-anysite";
  const KEY = "avidAnySite";
  const ORIGINS = ["http://*/*", "https://*/*"];

  async function enabled() {
    return (await chrome.storage.local.get(KEY))[KEY] === true;
  }

  async function register() {
    const allowed = (await enabled()) && (await chrome.permissions.contains({ origins: ORIGINS }));
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [ID] });
    if (!allowed) {
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [ID] });
      return;
    }
    const [main] = chrome.runtime.getManifest().content_scripts;
    // The manifest entry already covers the known platforms.
    if (!registered.length) {
      await chrome.scripting.registerContentScripts([{
        id: ID, matches: ORIGINS, excludeMatches: main.matches.filter((m) => m !== "file:///*"),
        js: main.js, runAt: "document_idle", allFrames: true, persistAcrossSessions: true,
      }]);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || (msg.type !== "AVID_ANYSITE_STATE" && msg.type !== "AVID_ANYSITE_SET")) return;
    // Only the options page may change this.
    if (sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL("options.html")) {
      sendResponse({ ok: false, error: "Not allowed." });
      return;
    }
    (async () => {
      if (msg.type === "AVID_ANYSITE_SET") {
        const on = msg.enabled === true;
        if (on && !(await chrome.permissions.contains({ origins: ORIGINS }))) throw new Error("Allow access to websites first.");
        await chrome.storage.local.set({ [KEY]: on });
        await register();
      }
      return { ok: true, enabled: (await enabled()) && (await chrome.permissions.contains({ origins: ORIGINS })) };
    })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  const init = () => register().catch(console.warn);
  chrome.runtime.onInstalled.addListener(init);
  chrome.runtime.onStartup.addListener(init);
  chrome.permissions.onRemoved.addListener(init);
})();
