// Opens the options page on first install and whenever the in-page widget or
// popup asks (content scripts can't open it directly).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "AVID_OPEN_OPTIONS") chrome.runtime.openOptionsPage();
});
