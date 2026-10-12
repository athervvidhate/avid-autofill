
// Opens first-run setup on install; the page drawer opens My Info on request.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
});

// The toolbar icon opens the same page-mounted drawer as the in-page launcher.
// activeTab gives this click permission to inject on an embedded or unlisted
// application page without expanding the extension's host permissions.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^(https?|file):/.test(tab.url || "")) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const states = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const A = globalThis.AvidAutofill;
        const open = A?.openDrawer || A?.widget?.open;
        const didOpen = typeof open === "function" && open();
        if (!didOpen && !A?.openDrawer) globalThis.__avidOpenDrawer = true;
        return { loaded: !!A?.adapters, opened: !!didOpen };
      },
    });
    if (states.some((item) => item.result?.opened)) return;
    // Avid already runs in some frame but nothing opened: the form frame (iCIMS)
    // defers to the outer page, so load Avid into the top frame alone.
    if (states.some((item) => item.frameId === 0 && item.result?.loaded)) return;
    const anyLoaded = states.some((item) => item.result?.loaded);
    const target = anyLoaded ? { tabId: tab.id, frameIds: [0] } : { tabId: tab.id, allFrames: true };
    const files = chrome.runtime.getManifest().content_scripts[0].js;
    await chrome.scripting.executeScript({ target, files });
    await chrome.scripting.executeScript({
      target,
      func: () => { globalThis.AvidAutofill?.openDrawer?.(); },
    });
  } catch (err) {
    console.warn("Avid Autofill: couldn't open the drawer", err);
  }
});

const icimsFrames = new Map(); // tab id -> frame id of its iCIMS form frame

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "AVID_OPEN_OPTIONS") chrome.runtime.openOptionsPage();
  // The iCIMS form frame says where it is, so the outer drawer's fill goes to
  // that frame alone instead of whichever frame in the tab answers first.
  if (msg && msg.type === "AVID_ICIMS_FRAME_READY" && sender.tab?.id != null && sender.frameId) {
    icimsFrames.set(sender.tab.id, sender.frameId);
    chrome.storage?.session?.set({ [`icimsFrame:${sender.tab.id}`]: sender.frameId }).catch(() => {});
    return false;
  }
  if (msg && msg.type === "AVID_FILL_ICIMS_FRAME" && sender.tab?.id != null && sender.frameId === 0) {
    const tabId = sender.tab.id;
    (async () => {
      let frameId = icimsFrames.get(tabId);
      if (frameId == null && chrome.storage?.session) frameId = (await chrome.storage.session.get(`icimsFrame:${tabId}`).catch(() => ({})))[`icimsFrame:${tabId}`];
      const send = (options) => (options ? chrome.tabs.sendMessage(tabId, msg, options) : chrome.tabs.sendMessage(tabId, msg));
      let response = frameId != null ? await send({ frameId }).catch(() => null) : null;
      // The frame moved or reloaded without saying so: ask every frame.
      if (!response) response = await send();
      return response || { ok: false, error: "The iCIMS form did not answer. Reload the page and try again." };
    })().then(sendResponse, (err) => {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    });
    return true;
  }
});
