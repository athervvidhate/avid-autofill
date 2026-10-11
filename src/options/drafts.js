(function () {
  const A = globalThis.AvidAutofill, D = A.drafts, $ = id => document.getElementById(id);
  const send = async (action, data = {}) => {
    const response = await chrome.runtime.sendMessage({ type: `AVID_DRAFT_${action}`, ...data });
    if (!response?.ok) throw new Error(response?.error || "Reload the extension and reopen My Info.");
    return response;
  };
  const nano = D.nanoProvider();
  async function renderNano() {
    const settings = await A.getSettings();
    $("polish-enabled").checked = settings.polishAnswers === true;
    const ready = await nano.available(), has = !!globalThis.LanguageModel;
    $("polish-download").hidden = ready || !has;
    $("polish-status").textContent = ready ? "Chrome's model is ready." : has ? "Chrome's model is not downloaded yet." : "This browser has no built-in AI, so written answers are used as saved.";
  }
  function render(state) {
    $("draft-provider").value = state.provider;
    $("draft-status").textContent = state.provider === "off" ? "No drafting key in use." : !state.hasKey ? "Enter your key and save." : !state.hasAccess ? "Allow access to the provider and save again." : "Your own key is in use for written answers.";
    $("draft-clear").disabled = state.provider === "off" && !state.hasKey;
  }
  $("polish-enabled").onchange = async () => {
    await A.saveSettings({ ...await A.getSettings(), polishAnswers: $("polish-enabled").checked });
    renderNano();
  };
  $("polish-download").onclick = async () => {
    $("polish-download").disabled = true;
    try {
      const session = await globalThis.LanguageModel.create({ expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }],
        monitor(m) { m.addEventListener("downloadprogress", e => { $("polish-status").textContent = `Downloading Chrome's model: ${Math.round(e.loaded * 100)}%`; }); } });
      session.destroy?.();
    } catch { $("polish-status").textContent = "Chrome could not download its model on this device."; }
    $("polish-download").disabled = false;
    renderNano();
  };
  $("draft-save").onclick = async () => {
    const provider = $("draft-provider").value, key = $("draft-key").value.trim();
    try {
      if (provider !== "off" && !await chrome.permissions.request({ origins: [D.PROVIDERS[provider].origin] })) throw new Error("Drafting stays off until access is allowed.");
      render(await send("SAVE", { provider, ...(key ? { key } : {}) }));
      $("draft-key").value = "";
    } catch (error) { $("draft-status").textContent = error.message; }
  };
  $("draft-clear").onclick = async () => {
    try { render(await send("CLEAR")); } catch (error) { $("draft-status").textContent = error.message; }
  };
  renderNano();
  send("STATE").then(render).catch(error => { $("draft-status").textContent = error.message; });
})();
