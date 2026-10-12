// Keeps the profile in step with chrome.storage.sync while profile sync is on:
// local edits are pushed a moment after they settle, and copies written by the
// applicant's other browsers are pulled in as they arrive.
(function () {
  const A = globalThis.AvidAutofill;
  const S = A.profileSync;
  let timer = null;

  const report = (err) => S.setState({ error: String((err && err.message) || err) }).catch(() => {});

  async function pushSoon() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        if (!(await S.getState()).enabled) return;
        await S.push(await A.getProfile());
      } catch (err) { report(err); }
    }, 2000);
  }

  async function pullNow() {
    try {
      if ((await S.getState()).enabled) await S.pull();
    } catch (err) { report(err); }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[A.STORAGE_KEY]) pushSoon();
    if (area === "sync" && changes[S.META]) pullNow();
  });
  chrome.runtime.onStartup?.addListener(pullNow);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !/^AVID_SYNC_/.test(msg.type)) return false;
    (async () => {
      try {
        if (msg.type === "AVID_SYNC_ENABLE") {
          const r = await S.enable(msg.choice);
          sendResponse({ ok: true, ...r, ...(await S.getState()) });
        } else if (msg.type === "AVID_SYNC_DISABLE") {
          await S.disable();
          sendResponse({ ok: true, ...(await S.getState()) });
        } else {
          sendResponse({ ok: true, ...(await S.getState()) });
        }
      } catch (err) {
        await report(err);
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  });
})();
