(function () {
  const box = document.getElementById("anysite-enabled");
  const msg = document.getElementById("anysite-msg");
  const ORIGINS = ["http://*/*", "https://*/*"];
  const send = (type, data = {}) => globalThis.AvidAutofill.request({ type, ...data }, "Reload the extension and try again.");
  box.onchange = async () => {
    const enabled = box.checked;
    box.disabled = true;
    try {
      // Request from this user gesture, before messaging the worker.
      if (enabled && !await chrome.permissions.request({ origins: ORIGINS })) {
        box.checked = false;
        msg.textContent = "Avid stays on its known job sites. The toolbar button still works on any page.";
        return;
      }
      box.checked = (await send("AVID_ANYSITE_SET", { enabled })).enabled;
      msg.textContent = box.checked ? "Avid will offer to fill pages that look like job applications." : "";
    } catch (e) {
      box.checked = !enabled;
      msg.textContent = e.message;
    } finally { box.disabled = false; }
  };
  send("AVID_ANYSITE_STATE").then((s) => { box.checked = s.enabled; }, () => {});
})();
