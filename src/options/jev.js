(function () {
  const J = globalThis.AvidAutofill.jev, $ = id => document.getElementById(id);
  let busy = false;
  async function send(action, data = {}) {
    const response = await chrome.runtime.sendMessage({ type: `AVID_JEV_${action}`, ...data });
    if (!response?.ok) throw new Error(response?.error || "Reload the extension and reopen My Info.");
    return response;
  }
  function render(state) {
    $("jev-enabled").checked = state.enabled;
    $("jev-status").textContent = !state.enabled ? "Jev is off. Saved answers still stay available in your profile." : !state.hasKey ? "Jev has no key for this browser session. Enter your key and save." : !state.hasAccess ? "Jev needs TypeSafe page access. Save again and allow it." : "Jev is enabled for this browser session.";
    $("jev-clear").disabled = !state.hasKey && !state.enabled;
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    $("jev-save").disabled = $("jev-clear").disabled = $("jev-enabled").disabled = $("jev-key").disabled = true;
    const enabled = $("jev-enabled").checked, key = $("jev-key").value.trim();
    try {
      if (action === "SAVE" && enabled && !await chrome.permissions.request({ origins: [J.ORIGIN] })) throw new Error("Jev stays off until TypeSafe page access is allowed.");
      const state = await send(action, action === "SAVE" ? { enabled, ...(key ? { key } : {}) } : {});
      $("jev-key").value = "";
      render(state);
    } catch (error) { $("jev-status").textContent = error.message; $("jev-clear").disabled = false; }
    finally { busy = false; $("jev-save").disabled = $("jev-enabled").disabled = $("jev-key").disabled = false; }
  }
  $("jev-save").onclick = () => run("SAVE");
  $("jev-clear").onclick = () => run("CLEAR");
  send("STATE").then(render).catch(error => { $("jev-status").textContent = error.message; });
})();
