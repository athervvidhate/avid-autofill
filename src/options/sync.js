(function () {
  const box = document.getElementById("sync-enabled");
  const msg = document.getElementById("sync-msg");
  const send = (type, data = {}) => globalThis.AvidAutofill.request({ type, ...data }, "Reload the extension and try again.");
  const when = (t) => t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

  function show(s) {
    box.checked = !!s.enabled;
    msg.textContent = s.error ? s.error : s.enabled ? (s.syncedAt ? `Synced ${when(s.syncedAt)}.` : "Syncing...") : "";
  }

  box.onchange = async () => {
    box.disabled = true;
    try {
      if (!box.checked) { show(await send("AVID_SYNC_DISABLE")); return; }
      let s = await send("AVID_SYNC_ENABLE");
      if (s.needsChoice) {
        const useRemote = confirm("Your other browser already synced a profile that differs from this one.\n\nOK: use the synced profile here (replaces this browser's profile).\nCancel: keep this browser's profile and sync it to the others.");
        s = await send("AVID_SYNC_ENABLE", { choice: useRemote ? "remote" : "local" });
      }
      show(s);
    } catch (e) {
      box.checked = false;
      msg.textContent = e.message;
    } finally { box.disabled = false; }
  };

  // A copy from another browser landed while this page is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.avidSyncState) {
      const next = changes.avidSyncState.newValue || {};
      show(next);
      // Reload so the page shows, and later saves, the profile that just arrived.
      if (next.pulledAt && next.pulledAt !== changes.avidSyncState.oldValue?.pulledAt) location.reload();
    }
  });
  send("AVID_SYNC_STATE").then(show, () => {});
})();
