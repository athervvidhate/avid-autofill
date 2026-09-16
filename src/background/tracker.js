(function () {
  const M = globalThis.AvidAutofill.trackerModel;
  const SESSION = "avidTrackerSession";
  const TOKEN = "avidGoogleToken";
  const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
  const DRIVE = "https://www.googleapis.com/drive/v3/files";
  const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
  let tasks = Promise.resolve();
  // ponytail: serialize this browser's tracker mutations; per-account queues if needed.
  function serial(fn) { const next = tasks.then(fn); tasks = next.catch(() => {}); return next; }
  async function state() {
    const saved = (await chrome.storage.local.get(M.KEY))[M.KEY];
    return { enabled: false, connection: null, entries: [], dismissed: [], ...saved };
  }
  const save = value => chrome.storage.local.set({ [M.KEY]: value });
  async function session() { return (await chrome.storage.session.get(SESSION))[SESSION] || { tabs: {} }; }
  const saveSession = value => chrome.storage.session.set({ [SESSION]: value });
  const sheetUrl = c => c?.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${c.spreadsheetId}/edit#gid=${c.sheetId || 0}` : "";
  const clientId = s => globalThis.AVID_GOOGLE_CLIENT_ID || s.clientId || "";
  function publicState(s, privileged = false) {
    return {
      enabled: s.enabled, connected: !!s.connection?.connected, sheetUrl: sheetUrl(s.connection),
      pending: s.entries.filter(e => e.state !== "synced").length,
      ...(privileged ? { email: s.connection?.email || "", configured: !!clientId(s), canEditClient: !globalThis.AVID_GOOGLE_CLIENT_ID && !s.connection?.sub, clientId: clientId(s), redirectUrl: chrome.identity.getRedirectURL("google"), error: s.connection?.error || "", entries: s.entries.filter(e => e.state !== "synced").map(e => ({ company: e.entry.company, role: e.entry.role, error: e.error || "Not synced yet" })) } : {}),
    };
  }
  async function fetchJson(url, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store" }); }
    catch { throw new Error("Google could not be reached. Your approved entries are kept in this browser."); }
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(response.status === 401 ? "Reconnect Google in Connections to finish syncing." : response.status === 403 ? "Google denied access. Check that the Sheets and Drive APIs are enabled and this account can edit the tracker." : response.status === 404 ? "The tracker sheet could not be found. Check Connections and restore the sheet if it was deleted." : response.status === 429 ? "Google is busy. Avid will retry your saved entries." : `Google could not complete the request (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function authorize(s, interactive) {
    const stored = (await chrome.storage.session.get(TOKEN))[TOKEN];
    if (!interactive && stored?.expiresAt > Date.now() + 60000 && stored.sub === s.connection?.sub) return stored.token;
    if (!clientId(s)) throw new Error("Google connection setup is needed. Open Connections for the OAuth setup instructions.");
    const redirect = chrome.identity.getRedirectURL("google");
    const nonce = crypto.randomUUID();
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({ client_id: clientId(s), redirect_uri: redirect, response_type: "token", scope: SCOPES.join(" "), state: nonce, prompt: interactive ? "select_account" : "none" }).toString();
    if (s.connection?.email) auth.searchParams.set("login_hint", s.connection.email);
    let result;
    try { result = await chrome.identity.launchWebAuthFlow({ url: auth.href, interactive }); }
    catch { throw new Error(interactive ? "Google connection was not completed. You can try again." : "Reconnect Google in Connections to finish syncing."); }
    let returned;
    try { returned = new URL(result); } catch { throw new Error("Google did not return a valid sign-in response."); }
    const expected = new URL(redirect);
    const params = new URLSearchParams(returned.hash.slice(1));
    if (returned.origin !== expected.origin || returned.pathname !== expected.pathname || params.get("state") !== nonce) throw new Error("Google sign-in could not be verified. Try connecting again.");
    const token = params.get("access_token");
    const lifetime = Number(params.get("expires_in"));
    if (params.has("error") || !token || params.get("token_type")?.toLowerCase() !== "bearer" || !Number.isFinite(lifetime) || lifetime <= 0) throw new Error("Google access was not granted. Try connecting again.");
    if (!SCOPES.every(scope => (params.get("scope") || "").split(" ").includes(scope) || (scope === "email" && (params.get("scope") || "").includes("userinfo.email")))) throw new Error("Allow access to the tracker spreadsheet to connect Google.");
    const user = await fetchJson("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (typeof user.sub !== "string" || typeof user.email !== "string" || !user.email_verified) throw new Error("Google could not verify this account.");
    if (s.connection?.sub && s.connection.sub !== user.sub) throw new Error(`Reconnect using ${s.connection.email}, the account linked to this tracker.`);
    s.connection ||= {};
    Object.assign(s.connection, { sub: user.sub, email: user.email, connected: true, error: "" });
    await save(s);
    await chrome.storage.session.set({ [TOKEN]: { token, sub: user.sub, expiresAt: Date.now() + Math.min(lifetime, 86400) * 1000 } });
    return token;
  }
  async function api(s, url, body, method = body ? "POST" : "GET") {
    const token = await authorize(s, false);
    try {
      return await fetchJson(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      if (error.status === 401) { await chrome.storage.session.remove(TOKEN); s.connection.connected = false; await save(s); }
      throw error;
    }
  }
  async function metadata(s, id) {
    try { return await api(s, `${SHEETS}/${s.connection.spreadsheetId}/developerMetadata/${id}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function repairDateColumns(s) {
    const data = await api(s, `${SHEETS}/${s.connection.spreadsheetId}/values:batchGetByDataFilter`, { dataFilters: [{ gridRange: { sheetId: s.connection.sheetId, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 7 } }], majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
    const rows = data.valueRanges?.[0]?.valueRange?.values || [];
    const requests = [];
    for (let i = 0; i < rows.length; i++) {
      for (const offset of [0, 2]) {
        if (M.STATUSES.includes(rows[i]?.[offset])) requests.push({ updateCells: { start: { sheetId: s.connection.sheetId, rowIndex: i + 1, columnIndex: offset + 4 }, rows: [{ values: [{}] }], fields: "userEnteredValue" } });
      }
    }
    if (requests.length) await api(s, `${SHEETS}/${s.connection.spreadsheetId}:batchUpdate`, { requests });
  }
  async function connect(s) {
    await authorize(s, true);
    const c = s.connection;
    if (!c.spreadsheetId) {
      c.setupId ||= crypto.randomUUID();
      await save(s);
      // The Drive property recovers a sheet if creation succeeded but its response was lost.
      const query = new URLSearchParams({ q: `trashed = false and appProperties has { key='avidTrackerSetup' and value='${c.setupId}' }`, fields: "files(id)", pageSize: "100" });
      const found = await api(s, `${DRIVE}?${query}`);
      let file = found.files?.[0];
      if (!file) {
        if (c.creationAttemptedAt && Date.now() - c.creationAttemptedAt < 180000) throw new Error("Sheet creation is still unconfirmed. Wait three minutes, then reconnect so Avid can recover it.");
        c.creationAttemptedAt = Date.now();
        await save(s);
        file = await api(s, `${DRIVE}?fields=id`, { name: "Job applications", mimeType: "application/vnd.google-apps.spreadsheet", appProperties: { avidTrackerSetup: c.setupId } });
      }
      if (!/^[\w-]+$/.test(file.id || "")) throw new Error("Google did not return the tracker spreadsheet ID.");
      c.spreadsheetId = file.id;
      await save(s);
    }
    const info = await api(s, `${SHEETS}/${c.spreadsheetId}?fields=sheets.properties`);
    if (c.sheetId == null) {
      c.sheetId = info.sheets?.[0]?.properties.sheetId;
      if (!Number.isInteger(c.sheetId)) throw new Error("The tracker worksheet is missing.");
      await save(s);
    }
    if (!info.sheets?.some(sheet => sheet.properties.sheetId === c.sheetId)) throw new Error("The Applications tab was deleted. Restore it in Google Sheets before reconnecting.");
    if (!c.templateVersion) {
      const marker = await metadata(s, 1);
      if (!marker) await api(s, `${SHEETS}/${c.spreadsheetId}:batchUpdate`, { requests: M.template(c.sheetId) });
      else if (marker.metadataKey !== "avidTemplate" || marker.metadataValue !== "1") throw new Error("This spreadsheet has an unexpected tracker format.");
      c.templateVersion = marker ? 1 : 3;
      c.columns = M.HEADERS;
      c.tabName = "Applications";
    }
    if (c.templateVersion < 3) {
      await api(s, `${SHEETS}/${c.spreadsheetId}:batchUpdate`, { requests: M.richColumns(c.sheetId) });
      await repairDateColumns(s);
      c.templateVersion = 3;
    }
    c.error = "";
    await save(s);
    await sync(s);
    return publicState(s, true);
  }
  async function sync(s) {
    const pending = s.entries.filter(e => e.state !== "synced");
    if (!pending.length || !s.connection?.connected || !s.connection?.templateVersion) return;
    try {
      // ponytail: read this small personal tracker once per batch; paginate if it reaches tens of thousands of rows.
      const data = await api(s, `${SHEETS}/${s.connection.spreadsheetId}/values:batchGetByDataFilter`, { dataFilters: [{ gridRange: { sheetId: s.connection.sheetId, startColumnIndex: 0, endColumnIndex: 10 } }], majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
      const rows = data.valueRanges?.[0]?.valueRange?.values || [];
      if (!M.HEADERS.every((h, i) => rows[0]?.[i] === h)) throw new Error("The tracker columns changed. Restore the original headers and order before syncing; Avid has kept your entries locally.");
      for (const record of pending) {
        if (record.spreadsheetId && record.spreadsheetId !== s.connection.spreadsheetId) throw new Error("A pending entry belongs to another tracker sheet.");
        record.spreadsheetId = s.connection.spreadsheetId;
        await save(s);
        const existing = rows.slice(1).find(row => row[8] === record.id || (!record.again && row[9] === record.key));
        let marker = await metadata(s, record.metadataId);
        if (existing || (marker?.metadataKey === "avidApplication" && marker.metadataValue === record.id)) {
          record.state = "synced";
          record.duplicate = !!existing && existing[8] !== record.id;
        } else {
          if (marker) {
            record.metadataId = 2 + (crypto.getRandomValues(new Uint32Array(1))[0] % 2147483645);
            await save(s);
            throw new Error("A tracker identifier collided. Your entry is safe and will retry with a new identifier.");
          }
          try { await api(s, `${SHEETS}/${s.connection.spreadsheetId}:batchUpdate`, { requests: M.writeRequests(record, s.connection.sheetId) }); }
          catch (error) {
            marker = await metadata(s, record.metadataId).catch(() => null);
            if (marker?.metadataKey !== "avidApplication" || marker.metadataValue !== record.id) throw error;
          }
          record.state = "synced";
          rows.push([record.entry.company, record.entry.role, record.entry.url, "", "", "", "", "", record.id, record.key]);
        }
        record.error = "";
        record.syncedAt = Date.now();
        await save(s);
      }
      s.connection.error = "";
    } catch (error) {
      for (const record of pending.filter(e => e.state !== "synced")) record.error = error.message;
      s.connection.error = error.message;
    }
    await save(s);
  }
  async function digest(value) {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, "0")).join("");
  }
  async function add(s, msg) {
    const entry = M.entry(msg.entry);
    const key = M.jobKey(entry.url);
    if (typeof msg.operationId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(msg.operationId)) throw new Error("Reopen the tracker prompt and try saving again.");
    const again = msg.again === true;
    const id = again ? msg.operationId : await digest(key);
    let record = s.entries.find(e => e.id === id || (!again && e.key === key));
    if (!record) {
      record = { id, key, entry, again, metadataId: parseInt(id.replaceAll("-", "").slice(0, 7), 16) + 2, state: "pending", createdAt: Date.now(), spreadsheetId: s.connection?.spreadsheetId || null };
      s.entries.push(record);
      s.dismissed = s.dismissed.filter(k => k !== key);
      await save(s); // Durable before any network request or success message.
    }
    await sync(s);
    return { ...publicState(s), record: { id: record.id, state: record.state, duplicate: record.duplicate, error: record.error || "", entry: record.entry } };
  }
  function cleanJob(value) {
    return { company: M.clean(value?.company, 200), role: M.clean(value?.role, 300), location: M.clean(value?.location, 200), url: M.jobUrl(value?.url) };
  }
  function origin(value) { try { return new URL(value).origin; } catch { return ""; } }
  async function capture(s, msg, sender) {
    const data = msg.snapshot;
    if (!data || typeof data !== "object") return {};
    const sess = await session();
    const tab = sess.tabs[sender.tab.id] ||= { frames: {}, prompts: [] };
    const frame = String(sender.frameId || 0);
    const previous = tab.frames[frame];
    const recent = previous && Date.now() - previous.at < 2 * 60 * 60 * 1000;
    const related = recent && (origin(sender.url) === origin(previous.pageUrl) || origin(data.referrer) === origin(previous.pageUrl));
    let job = cleanJob(data.job);
    if (data.isJob && job.url) {
      if (related && (M.jobKey(job.url) === M.jobKey(previous.job.url) || (job.role && job.role === previous.job.role))) {
        job = { ...previous.job, ...Object.fromEntries(Object.entries(job).filter(([, v]) => v)) };
      }
      tab.frames[frame] = { job, at: Date.now(), pageUrl: sender.url, confirmed: false };
    } else if (data.confirmed && related) {
      job = previous.job;
    } else if (!data.confirmed || !data.confirmationContext) {
      // Preserve context on intermediate steps, but never carry it to another origin.
      if (!related) delete tab.frames[frame];
      await saveSession(sess);
      return {};
    }
    if (data.confirmed && job.url && (related || data.confirmationContext)) {
      tab.frames[frame] = { job, at: Date.now(), pageUrl: sender.url, confirmed: true };
      const key = M.jobKey(job.url);
      if (s.enabled && !tab.prompts.includes(key) && !s.dismissed.includes(key) && !s.entries.some(e => e.key === key)) {
        tab.prompts.push(key);
        await saveSession(sess);
        const result = preview(s, job, true);
        if (sender.frameId) {
          try { await chrome.tabs.sendMessage(sender.tab.id, { type: "AVID_TRACKER_SHOW", preview: result }, { frameId: 0 }); return {}; }
          catch { /* An embedded ATS can still show the prompt without parent access. */ }
        }
        return { preview: result };
      }
    }
    await saveSession(sess);
    return {};
  }
  function preview(s, job, confirmed) {
    const key = M.jobKey(job.url);
    const existing = s.entries.find(e => e.key === key);
    return { ...publicState(s), job, confirmed, existing: existing ? { id: existing.id, state: existing.state, error: existing.error || "" } : null, operationId: crypto.randomUUID() };
  }
  async function manual(s, msg, sender) {
    if (msg.snapshot) await capture({ ...s, enabled: false }, msg, sender);
    const sess = await session();
    const frames = Object.values(sess.tabs[sender.tab.id]?.frames || {}).filter(v => Date.now() - v.at < 2 * 60 * 60 * 1000).sort((a, b) => b.at - a.at);
    const frame = frames[0];
    return { preview: preview(s, frame?.job || { ...cleanJob(msg.snapshot?.job), url: M.jobUrl(msg.snapshot?.job?.url) || M.jobUrl(sender.url) }, !!frame?.confirmed) };
  }
  async function register(s, inject = false) {
    const allowed = s.enabled && await chrome.permissions.contains({ origins: M.ORIGINS });
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: ["avid-job-tracker"] });
    if (!allowed) {
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: ["avid-job-tracker"] });
      return;
    }
    if (!registered.length) await chrome.scripting.registerContentScripts([{ id: "avid-job-tracker", matches: M.ORIGINS, js: M.SCRIPTS, runAt: "document_idle", allFrames: true, persistAcrossSessions: true }]);
    if (inject) {
      const tabs = await chrome.tabs.query({ url: M.ORIGINS });
      // A suspended tab can leave injection pending. It must not block the tracker queue.
      void Promise.allSettled(tabs.filter(t => t.id && !t.discarded).map(t => chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: M.SCRIPTS })));
    }
  }
  function privileged(sender) {
    const root = chrome.runtime.getURL("src/options/options.html");
    return sender.url?.split(/[?#]/)[0] === root;
  }
  async function handle(msg, sender) {
    const s = await state();
    const admin = privileged(sender);
    const content = Number.isInteger(sender.tab?.id) && /^https?:\/\//.test(sender.url || "");
    if (!admin && !content) throw new Error("This tracker request is not allowed.");
    switch (msg.type) {
      case "AVID_TRACKER_STATE": return publicState(s, admin);
      case "AVID_TRACKER_OPEN_CONNECTIONS": await chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#connections") }); return {};
      case "AVID_TRACKER_CAPTURE": if (content) return capture(s, msg, sender); break;
      case "AVID_TRACKER_PREVIEW": if (content) return manual(s, msg, sender); break;
      case "AVID_TRACKER_ADD": if (content) return add(s, msg); break;
      case "AVID_TRACKER_DISMISS": {
        if (!content) break;
        const key = M.jobKey(msg.url);
        if (key && !s.dismissed.includes(key)) { s.dismissed.push(key); await save(s); }
        return {};
      }
    }
    if (!admin) throw new Error("Open Connections to change Google settings.");
    switch (msg.type) {
      case "AVID_TRACKER_CLIENT":
        if (globalThis.AVID_GOOGLE_CLIENT_ID || s.connection?.sub) throw new Error("The OAuth client cannot change while a tracker account is configured.");
        if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(msg.clientId || "")) throw new Error("Enter a valid Google OAuth web client ID.");
        s.clientId = msg.clientId; await save(s); return publicState(s, true);
      case "AVID_TRACKER_ENABLE":
        if (msg.enabled && !await chrome.permissions.contains({ origins: M.ORIGINS })) throw new Error("Allow access to career pages to enable automatic tracking.");
        s.enabled = msg.enabled === true; await save(s); await register(s, s.enabled); return publicState(s, true);
      case "AVID_TRACKER_CONNECT":
        try { return await connect(s); }
        catch (error) { if (s.connection) { s.connection.error = error.message; await save(s); } throw error; }
      case "AVID_TRACKER_DISCONNECT":
        await chrome.storage.session.remove(TOKEN);
        if (s.connection) { s.connection.connected = false; s.connection.error = "Google is disconnected. Your sheet and pending entries are kept."; }
        await save(s); return publicState(s, true);
      case "AVID_TRACKER_RETRY": await sync(s); return publicState(s, true);
      default: throw new Error("Unknown tracker request.");
    }
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (typeof msg?.type !== "string" || !msg.type.startsWith("AVID_TRACKER_") || msg.type === "AVID_TRACKER_SHOW") return;
    serial(() => handle(msg, sender)).then(value => sendResponse({ ok: true, ...value }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
  const init = () => serial(async () => { await chrome.alarms.create("avid-tracker-sync", { periodInMinutes: 2 }); await register(await state()); }).catch(console.warn);
  chrome.runtime.onInstalled.addListener(init);
  chrome.runtime.onStartup.addListener(init);
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === "avid-tracker-sync") serial(async () => sync(await state())).catch(console.warn);
  });
  chrome.permissions.onRemoved.addListener(() => serial(async () => {
    const s = await state();
    if (!await chrome.permissions.contains({ origins: M.ORIGINS })) { s.enabled = false; await save(s); }
    await register(s);
  }).catch(console.warn));
  chrome.tabs.onRemoved.addListener(tabId => serial(async () => { const sess = await session(); delete sess.tabs[tabId]; await saveSession(sess); }).catch(console.warn));
})();
