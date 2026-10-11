// The job description for the page being applied to. Application forms often
// sit apart from the posting, so the text is remembered per posting while the
// applicant browses (the same store the Workday skills step already uses).
(function () {
  const A = globalThis.AvidAutofill = globalThis.AvidAutofill || {};
  const STORE = "avidJobDesc", MAX_STORED = 20, MAX = 12000;
  const SELECTORS = [
    '[data-automation-id="jobPostingDescription"]', "#content .job__description", "#job-description", '[data-qa="job-description"]', ".posting-page .section-wrapper",
    '[class*="_descriptionText"]', '[class*="job-description" i]', '[id*="job-description" i]', '[class*="jobDescription"]', '[class*="job_description"]', '[itemprop="description"]',
  ];
  const squash = text => String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX);
  const strip = html => { const div = document.createElement("div"); div.innerHTML = String(html || ""); return div.textContent || ""; };
  function fromJsonLd() {
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const items = [].concat(JSON.parse(node.textContent || "null") || []).flatMap(item => item && item["@graph"] ? item["@graph"] : [item]);
        const posting = items.find(item => item && [].concat(item["@type"] || []).includes("JobPosting"));
        if (posting && posting.description) return squash(strip(posting.description));
      } catch { /* ignore malformed structured data */ }
    }
    return "";
  }
  function read() {
    const data = fromJsonLd();
    if (data.length >= 200) return data;
    for (const selector of SELECTORS) {
      let text = "";
      try { text = squash(document.querySelector(selector)?.textContent); } catch { continue; }
      if (text.length >= 200) return text;
    }
    return "";
  }
  const keyOf = () => A.trackerModel?.jobUrl?.(location.href) || "";
  async function remember(text) {
    const key = keyOf();
    if (!key || !text || typeof chrome === "undefined" || !chrome.storage) return;
    try {
      const stored = (await chrome.storage.local.get(STORE))[STORE] || {};
      stored[key] = { text, at: Date.now() };
      const keep = Object.entries(stored).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_STORED);
      await chrome.storage.local.set({ [STORE]: Object.fromEntries(keep) });
    } catch { /* remembering is best effort */ }
  }
  // The description on this page, else the one remembered for this posting.
  async function load() {
    const live = read();
    if (live) { remember(live); return live; }
    const key = keyOf();
    if (!key || typeof chrome === "undefined" || !chrome.storage) return "";
    try { return squash((((await chrome.storage.local.get(STORE))[STORE] || {})[key] || {}).text); } catch { return ""; }
  }
  A.posting = { read, load, remember };
})();
