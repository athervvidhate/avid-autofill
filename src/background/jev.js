(function () {
  const A = globalThis.AvidAutofill, J = A.jev;
  const active = new Set();
  const optionsSender = sender => sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL("src/options/options.html");
  async function state() {
    const settings = await A.getSettings(), session = await chrome.storage.session.get(J.KEY);
    return { enabled: settings.jevEnabled === true, hasKey: !!session[J.KEY], hasAccess: await chrome.permissions.contains({ origins: [J.ORIGIN] }) };
  }
  async function save(msg) {
    if (typeof msg.enabled !== "boolean" || (msg.key !== undefined && (typeof msg.key !== "string" || !msg.key.trim() || msg.key.length > 512 || /\s/.test(msg.key)))) throw new Error("Enter a valid Jev API key.");
    if (msg.enabled && !await chrome.permissions.contains({ origins: [J.ORIGIN] })) throw new Error("Allow access to TypeSafe AI before enabling Jev.");
    const key = msg.key || (await chrome.storage.session.get(J.KEY))[J.KEY];
    if (msg.enabled && !key) throw new Error("Enter your Jev API key to enable matching.");
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    if (msg.key) await chrome.storage.session.set({ [J.KEY]: msg.key });
    await A.saveSettings({ ...await A.getSettings(), jevEnabled: msg.enabled });
    return state();
  }
  async function call(request, key) {
    const body = JSON.stringify(request);
    if (new TextEncoder().encode(body).length > 60000) throw new Error("Jev context is too large. Use fewer or shorter question-bank entries.");
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body, signal: abort.signal, credentials: "omit", redirect: "error",
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Jev rejected the API key. Re-enter it in My Info." : [429, 529].includes(response.status) ? "Jev is busy or rate limited. Try filling again shortly." : "Jev could not complete the request. Try filling again.");
      let payload;
      try { payload = await response.json(); } catch { throw new Error("Jev returned invalid JSON. No AI answers were applied."); }
      return J.validate(request, payload);
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Jev timed out. Try filling again.");
      if (error instanceof TypeError) throw new Error("Could not reach Jev. Check your connection and TypeSafe page access.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function fill(msg, sender) {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !/^(https?|file):/.test(sender.url || "")) throw new Error("Jev matching must start from an application page.");
    const run = `${sender.tab.id}:${sender.frameId || 0}`;
    if (active.has(run)) throw new Error("Jev is already matching this page. Wait for it to finish.");
    active.add(run);
    try {
      const fields = J.cleanFields(msg.fields), settings = await A.getSettings();
      if (!settings.jevEnabled) throw new Error("Jev is off. Enable it in My Info.");
      if (!await chrome.permissions.contains({ origins: [J.ORIGIN] })) throw new Error("TypeSafe page access is missing. Re-enable Jev in My Info.");
      const key = (await chrome.storage.session.get(J.KEY))[J.KEY];
      if (!key) throw new Error("Re-enter your Jev API key in My Info for this browser session.");
      const profile = await A.getProfile(), sources = J.sourcesFor(profile, sender.url);
      if (!Object.keys(sources).length) throw new Error("Save profile details or approved question-bank answers before using Jev.");
      async function fresh() {
        if (JSON.stringify(await A.getProfile()) !== JSON.stringify(profile) || !(await A.getSettings()).jevEnabled || (await chrome.storage.session.get(J.KEY))[J.KEY] !== key || !await chrome.permissions.contains({ origins: [J.ORIGIN] })) throw new Error("Profile or Jev connection changed. Fill the page again.");
      }
      const answers = await call(J.requestFor(fields, sources), key), selections = {};
      const optionFields = fields.filter(field => {
        const answer = answers[`answer_${field.id}`];
        if (J.accepted(answer)) selections[field.id] = answer.choice;
        return field.options && selections[field.id];
      });
      let optionAnswers = {};
      if (optionFields.length) {
        await fresh();
        optionAnswers = await call(J.requestFor(optionFields, sources, selections), key);
      }
      await fresh();
      const results = fields.map(field => {
        const source = sources[selections[field.id]], answer = field.options ? optionAnswers[`answer_${field.id}`] : answers[`answer_${field.id}`];
        if (!source || !answer || !J.accepted(answer)) return { id: field.id, status: "ai-needs-answer" };
        if (field.type === "email" && source.kind !== "email" || field.type === "tel" && source.kind !== "tel" || field.type === "url" && source.kind !== "url") return { id: field.id, status: "ai-incompatible" };
        return { id: field.id, status: "fill", sourceId: selections[field.id], sourceQuestion: source.description, value: source.value, ...(field.options ? { optionId: answer.choice } : {}) };
      });
      return { results };
    } finally { active.delete(run); }
  }
  async function handle(msg, sender) {
    if (msg.type === "AVID_JEV_FILL") return fill(msg, sender);
    if (!optionsSender(sender)) throw new Error("Open My Info to change the Jev connection.");
    if (msg.type === "AVID_JEV_STATE") return state();
    if (msg.type === "AVID_JEV_SAVE") return save(msg);
    if (msg.type === "AVID_JEV_CLEAR") {
      await A.saveSettings({ ...await A.getSettings(), jevEnabled: false });
      await chrome.storage.session.remove(J.KEY);
      return state();
    }
    throw new Error("Unknown Jev action.");
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg?.type?.startsWith("AVID_JEV_")) return false;
    handle(msg, sender).then(value => sendResponse({ ok: true, ...value }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
