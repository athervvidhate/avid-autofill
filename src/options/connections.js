(function () {
  const M = globalThis.AvidAutofill.trackerModel;
  const $ = id => document.getElementById(id);
  let busy = false;
  async function send(action, data = {}) {
    const result = await chrome.runtime.sendMessage({ type: `AVID_TRACKER_${action}`, ...data });
    if (!result?.ok) throw new Error(result?.error || "Reload the extension and reopen Connections.");
    return result;
  }
  function render(s) {
    $("google-account").textContent = s.email || "Not connected";
    $("google-badge").textContent = s.connected ? s.pending ? "Sync pending" : "Connected" : "Not connected";
    $("google-connect").textContent = s.email ? "Reconnect Google" : "Connect Google and create tracker";
    $("google-disconnect").hidden = !s.connected;
    $("google-connect").disabled = busy || !s.configured;
    $("tracker-enabled").checked = s.enabled;
    $("tracker-sheet").hidden = !s.sheetUrl;
    if (s.sheetUrl) $("tracker-sheet").href = s.sheetUrl;
    $("google-setup").hidden = !s.canEditClient;
    $("google-setup").open = !s.configured;
    $("google-redirect").value = s.redirectUrl || "";
    if (!$('google-client-id').matches(":focus")) $("google-client-id").value = s.clientId || "";
    $("connection-msg").textContent = s.error || (s.connected && s.sheetUrl ? "Tracker ready. Connection changes save automatically." : "");
    $("tracker-pending").hidden = !s.pending;
    $("tracker-pending-count").textContent = `${s.pending} ${s.pending === 1 ? "application" : "applications"} not synced yet`;
    $("tracker-pending-list").replaceChildren();
    for (const item of s.entries || []) {
      const li = document.createElement("li");
      li.textContent = `${item.company} · ${item.role}: ${item.error}`;
      $("tracker-pending-list").append(li);
    }
  }
  async function run(action, data = {}) {
    if (busy) return;
    busy = true;
    $("tracker-enabled").disabled = true;
    for (const button of document.querySelectorAll("#connections button")) button.disabled = true;
    $("connection-msg").textContent = action === "CONNECT" ? "Finish connecting in Google's sign-in window..." : "Saving...";
    let error;
    try { await send(action, data); } catch (e) { error = e.message; }
    busy = false;
    $("tracker-enabled").disabled = false;
    for (const button of document.querySelectorAll("#connections button")) button.disabled = false;
    try { render(await send("STATE")); } catch (e) { error ||= e.message; }
    if (error) $("connection-msg").textContent = error;
  }
  $("google-connect").onclick = () => run("CONNECT");
  $("google-disconnect").onclick = () => run("DISCONNECT");
  $("tracker-retry").onclick = () => run("RETRY");
  $("google-client-save").onclick = () => run("CLIENT", { clientId: $("google-client-id").value.trim() });
  $("tracker-enabled").onchange = async event => {
    const enabled = event.target.checked;
    try {
      // Request directly from this user gesture, before messaging the worker.
      if (enabled && !await chrome.permissions.request({ origins: M.ORIGINS })) {
        event.target.checked = false;
        $("connection-msg").textContent = "Automatic tracking stays off. The manual Track application button still works.";
        return;
      }
      await run("ENABLE", { enabled });
    } catch (e) { event.target.checked = false; $("connection-msg").textContent = e.message; }
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[M.KEY] && !busy) send("STATE").then(render).catch(e => { $("connection-msg").textContent = e.message; });
  });
  send("STATE").then(render).catch(e => { $("connection-msg").textContent = e.message; });
})();
