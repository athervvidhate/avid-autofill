(function () {
  const A = globalThis.AvidAutofill, D = A.drafts;
  const optionsSender = sender => sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL("options.html");
  const pageSender = sender => sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && /^(https?|file):/.test(sender.url || "");
  const active = new Set();
  async function state() {
    const settings = await A.getSettings(), stored = await chrome.storage.local.get(D.KEY), provider = D.PROVIDERS[settings.draftProvider];
    return { provider: provider ? settings.draftProvider : "off", hasKey: !!stored[D.KEY], hasAccess: provider ? await chrome.permissions.contains({ origins: [provider.origin] }) : false };
  }
  async function save(msg) {
    const provider = D.PROVIDERS[msg.provider];
    if (msg.provider !== "off" && !provider) throw new Error("Choose a drafting provider.");
    if (msg.key !== undefined && (typeof msg.key !== "string" || !msg.key.trim() || msg.key.length > 512 || /\s/.test(msg.key))) throw new Error("Enter a valid key.");
    if (provider) {
      if (!await chrome.permissions.contains({ origins: [provider.origin] })) throw new Error(`Allow access to ${provider.name} before turning it on.`);
      if (!msg.key && !(await chrome.storage.local.get(D.KEY))[D.KEY]) throw new Error(`Enter your ${provider.name} key.`);
    }
    if (msg.key) await chrome.storage.local.set({ [D.KEY]: msg.key });
    await A.saveSettings({ ...await A.getSettings(), draftProvider: msg.provider });
    return state();
  }
  // The page asks for a rewrite; the provider, key and endpoint all come from
  // stored settings, never from the message.
  async function rewrite(msg, sender) {
    if (!pageSender(sender)) throw new Error("Drafting must start from an application page.");
    if (typeof msg.prompt !== "string" || !msg.prompt || msg.prompt.length > 9000) throw new Error("Invalid drafting request.");
    const settings = await A.getSettings(), provider = D.PROVIDERS[settings.draftProvider];
    if (!provider || !await chrome.permissions.contains({ origins: [provider.origin] })) throw new Error("Drafting is off.");
    const key = (await chrome.storage.local.get(D.KEY))[D.KEY];
    if (!key) throw new Error("Enter your drafting key in My Info.");
    const run = `${sender.tab.id}:${sender.frameId || 0}`;
    if (active.has(run)) throw new Error("Drafting is already running on this page.");
    active.add(run);
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), D.TIMEOUT);
    try { return { text: await D.hostedRewrite(settings.draftProvider, key, msg.prompt, fetch, abort.signal) }; }
    finally { clearTimeout(timer); active.delete(run); }
  }
  async function handle(msg, sender) {
    if (msg.type === "AVID_DRAFT_REWRITE") return rewrite(msg, sender);
    if (!optionsSender(sender)) throw new Error("Open My Info to change drafting.");
    if (msg.type === "AVID_DRAFT_STATE") return state();
    if (msg.type === "AVID_DRAFT_SAVE") return save(msg);
    if (msg.type === "AVID_DRAFT_CLEAR") {
      await A.saveSettings({ ...await A.getSettings(), draftProvider: "off" });
      await chrome.storage.local.remove(D.KEY);
      return state();
    }
    throw new Error("Unknown drafting action.");
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg?.type?.startsWith("AVID_DRAFT_")) return false;
    handle(msg, sender).then(value => sendResponse({ ok: true, ...value }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
