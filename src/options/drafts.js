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
    $("draft-nano").checked = settings.draftAnswers === true;
    const ready = await nano.available(), has = !!globalThis.LanguageModel;
    $("draft-download").hidden = ready || !has;
    $("draft-nano-status").textContent = ready ? "Chrome's model is ready." : has ? "Chrome's model is not downloaded yet." : "This browser has no built-in AI, so written answers are used as saved.";
  }
  function render(state) {
    $("draft-provider").value = state.provider;
    $("draft-status").textContent = state.provider === "off" ? "No drafting key in use." : !state.hasKey ? "Enter your key and save." : !state.hasAccess ? "Allow access to the provider and save again." : "Your own key is in use for written answers.";
    $("draft-clear").disabled = state.provider === "off" && !state.hasKey;
  }
  $("draft-nano").onchange = async () => {
    await A.saveSettings({ ...await A.getSettings(), draftAnswers: $("draft-nano").checked });
    renderNano();
  };
  $("draft-download").onclick = async () => {
    $("draft-download").disabled = true;
    try {
      const session = await globalThis.LanguageModel.create({ expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }],
        monitor(m) { m.addEventListener("downloadprogress", e => { $("draft-nano-status").textContent = `Downloading Chrome's model: ${Math.round(e.loaded * 100)}%`; }); } });
      session.destroy?.();
    } catch { $("draft-nano-status").textContent = "Chrome could not download its model on this device."; }
    $("draft-download").disabled = false;
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
