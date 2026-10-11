(function () {
  const A = globalThis.AvidAutofill, J = A.jev;
  const active = new Set();
  const optionsSender = sender => sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL("options.html");
  async function state() {
    const settings = await A.getSettings(), stored = await chrome.storage.local.get(J.KEY);
    return { enabled: settings.jevEnabled === true, hasKey: !!stored[J.KEY], hasAccess: await chrome.permissions.contains({ origins: [J.ORIGIN] }) };
  }
  async function save(msg) {
    if (typeof msg.enabled !== "boolean" || (msg.key !== undefined && (typeof msg.key !== "string" || !msg.key.trim() || msg.key.length > 512 || /\s/.test(msg.key)))) throw new Error("Enter a valid Jev API key.");
    if (msg.enabled && !await chrome.permissions.contains({ origins: [J.ORIGIN] })) throw new Error("Allow access to TypeSafe AI before enabling Jev.");
    const key = msg.key || (await chrome.storage.local.get(J.KEY))[J.KEY];
    if (msg.enabled && !key) throw new Error("Enter your Jev API key to enable matching.");
    if (msg.key) await chrome.storage.local.set({ [J.KEY]: msg.key });
    await A.saveSettings({ ...await A.getSettings(), jevEnabled: msg.enabled });
    return state();
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
      const key = (await chrome.storage.local.get(J.KEY))[J.KEY];
      if (!key) throw new Error("Enter your Jev API key in My Info.");
      const profile = await A.getProfile(), sources = J.sourcesFor(profile, sender.url);
      if (!Object.keys(sources).length) throw new Error("Save profile details or approved question-bank answers before using Jev.");
      async function fresh() {
        if (JSON.stringify(await A.getProfile()) !== JSON.stringify(profile) || !(await A.getSettings()).jevEnabled || (await chrome.storage.local.get(J.KEY))[J.KEY] !== key || !await chrome.permissions.contains({ origins: [J.ORIGIN] })) throw new Error("Profile or Jev connection changed. Fill the page again.");
      }
      const { results } = await J.match(fields, sources, request => J.post(request, key), fresh);
      return { results };
    } finally { active.delete(run); }
  }
  // The page drawer saves an answer the applicant gave on the page. The scope
  // comes from the sender's URL, never from the message.
  async function saveAnswer(msg, sender) {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !/^https?:/.test(sender.url || "")) throw new Error("Save answers from an application page.");
    await A.saveProfile(J.saveAnswer(await A.getProfile(), msg, sender.url));
    return {};
  }
  // Which skills to add to an application's skills section: Jev judges each
  // candidate against the job description and the saved profile. The caller
  // falls back to local ranking on any error.
  async function skills(msg, sender) {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !/^https?:/.test(sender.url || "")) throw new Error("Skills matching must start from an application page.");
    const description = typeof msg.description === "string" ? msg.description.trim() : "";
    if (!description) throw new Error("No job description to match skills against.");
    if (!(await A.getSettings()).jevEnabled || !await chrome.permissions.contains({ origins: [J.ORIGIN] })) throw new Error("Jev is off.");
    const key = (await chrome.storage.local.get(J.KEY))[J.KEY];
    if (!key) throw new Error("Enter your Jev API key in My Info.");
    const profile = await A.getProfile(), candidates = A.skills.candidatesFor(profile, description);
    if (!candidates.length) return { skills: [] };
    const { answers } = await J.post(A.skills.requestFor(J.MODEL, profile, description, candidates), key);
    return { skills: A.skills.select(profile, description, candidates, answers) };
  }
  async function handle(msg, sender) {
    if (msg.type === "AVID_JEV_FILL") return fill(msg, sender);
    if (msg.type === "AVID_JEV_SKILLS") return skills(msg, sender);
    if (msg.type === "AVID_JEV_SAVE_ANSWER") return saveAnswer(msg, sender);
    if (!optionsSender(sender)) throw new Error("Open My Info to change the Jev connection.");
    if (msg.type === "AVID_JEV_STATE") return state();
    if (msg.type === "AVID_JEV_SAVE") return save(msg);
    if (msg.type === "AVID_JEV_CLEAR") {
      await A.saveSettings({ ...await A.getSettings(), jevEnabled: false });
      await chrome.storage.local.remove(J.KEY);
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
