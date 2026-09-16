// Opens the options page on first install and whenever the page drawer asks.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
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
        const open = A?.widget?.open;
        const didOpen = typeof open === "function" && open();
        if (!didOpen) globalThis.__avidOpenDrawer = true;
        return { loaded: !!A?.adapters, opened: !!didOpen };
      },
    });
    if (states.some((item) => item.result?.opened || item.result?.loaded)) return;
    const files = chrome.runtime.getManifest().content_scripts[0].js;
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => { globalThis.AvidAutofill?.widget?.open?.(); },
    });
  } catch (err) {
    console.warn("Avid Autofill: couldn't open the drawer", err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "AVID_OPEN_OPTIONS") chrome.runtime.openOptionsPage();
  if (msg && msg.type === "AVID_FILL_ICIMS_FRAME" && sender.tab?.id != null && sender.frameId === 0) {
    chrome.tabs.sendMessage(sender.tab.id, msg).then(sendResponse, (err) => {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    });
    return true;
  }
});
