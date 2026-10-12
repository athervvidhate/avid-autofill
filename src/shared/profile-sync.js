// Profile sync across the applicant's own Chrome browsers, through chrome.storage.sync.
// Chrome carries it with the browser's own sign-in: no server of ours and no extra
// account. Only the profile text syncs (about 100 KB fits). The resume file, keys
// and settings stay on each device.
(function () {
  const A = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  if (A.profileSync) return;

  const META = "avidSync:meta";
  const PART = "avidSync:"; // avidSync:0, avidSync:1, ...
  const STATE = "avidSyncState"; // local only: { enabled, hash, syncedAt, error }
  const CHUNK = 2000; // characters; under Chrome's 8 KB per item even if every one is 3 bytes
  const MAX_PARTS = 45; // 45 x ~6 KB keeps well inside the 100 KB total

  // FNV-1a, enough to tell two profiles apart.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  // The profile as it syncs: everything but what describes this device's import.
  function serialize(profile) {
    const { meta: _meta, ...rest } = profile || {};
    return JSON.stringify(rest);
  }

  function split(text) {
    const parts = [];
    for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
    return parts.length ? parts : [""];
  }

  const isEmpty = (profile) => !profile || !(profile.personal?.email || profile.personal?.fullName || (profile.work || []).length);

  async function getState() {
    const data = await chrome.storage.local.get(STATE);
    return { enabled: false, hash: "", syncedAt: 0, error: "", ...(data[STATE] || {}) };
  }
  async function setState(patch) {
    const next = { ...(await getState()), ...patch };
    await chrome.storage.local.set({ [STATE]: next });
    return next;
  }

  // The synced copy, or null when there is none or it is incomplete.
  async function readRemote() {
    const meta = (await chrome.storage.sync.get(META))[META];
    if (!meta || !meta.parts) return null;
    const keys = Array.from({ length: meta.parts }, (_, i) => PART + i);
    const data = await chrome.storage.sync.get(keys);
    const text = keys.map((k) => data[k] ?? "").join("");
    // Parts from a newer write can land before its meta: wait for the next change.
    if (hash(text) !== meta.hash) return null;
    try { return { meta, profile: JSON.parse(text) }; } catch (_) { return null; }
  }

  async function push(profile) {
    const text = serialize(profile);
    const h = hash(text);
    const parts = split(text);
    if (parts.length > MAX_PARTS) throw new Error("Your profile is too large for Chrome sync. Shorten long descriptions or saved answers.");
    const old = (await chrome.storage.sync.get(META))[META];
    if (old && old.hash === h) { await setState({ hash: h, syncedAt: Date.now(), error: "" }); return false; }
    const items = {};
    parts.forEach((p, i) => { items[PART + i] = p; });
    await chrome.storage.sync.set(items);
    // Meta last, so another device never reads a half-written profile.
    await chrome.storage.sync.set({ [META]: { parts: parts.length, hash: h, updatedAt: Date.now() } });
    const stale = [];
    for (let i = parts.length; i < (old?.parts || 0); i++) stale.push(PART + i);
    if (stale.length) await chrome.storage.sync.remove(stale);
    await setState({ hash: h, syncedAt: Date.now(), error: "" });
    return true;
  }

  // Take the synced copy into this device, keeping this device's import details.
  async function pull() {
    const remote = await readRemote();
    if (!remote) return false;
    const state = await getState();
    if (remote.meta.hash === state.hash) return false;
    const local = await A.getProfile();
    if (hash(serialize(local)) !== remote.meta.hash) {
      await A.saveProfile({ ...remote.profile, meta: local.meta });
    }
    await setState({ hash: remote.meta.hash, syncedAt: Date.now(), error: "", pulledAt: Date.now() });
    return true;
  }

  // Turning sync on. With profiles on both sides that differ, the caller picks:
  // "remote" uses the synced copy here, "local" replaces it with this device's.
  async function enable(choice) {
    const remote = await readRemote();
    const local = await A.getProfile();
    const differs = remote && remote.meta.hash !== hash(serialize(local));
    if (differs && !isEmpty(local) && !choice) return { needsChoice: true };
    await setState({ enabled: true, hash: "", error: "" });
    if (remote && (choice === "remote" || (differs && isEmpty(local)))) await pull();
    else await push(local);
    return { needsChoice: false };
  }

  async function disable() {
    await setState({ enabled: false, error: "" });
  }

  A.profileSync = { META, STATE, PART, hash, serialize, split, readRemote, push, pull, enable, disable, getState, setState, isEmpty };
})();
