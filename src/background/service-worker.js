// Minimal service worker. The heavy lifting is in the content script; this just
// opens the options page on first install so the user seeds their profile.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});
