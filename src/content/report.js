// "Report a problem" for store builds, and the scrubbed page snapshot shared with the
// dev-only Export DOM tool. Nothing here sends anything: the drawer shows the report,
// the user saves it, and their own email app (or a GitHub issue) carries it.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  if (AvidAutofill.report) return;

  // Where problem reports are emailed. If this is ever emptied the drawer opens a prefilled
  // GitHub issue instead.
  const REPORT_EMAIL = "athervvidhate@gmail.com";
  const ISSUES_URL = "https://github.com/athervvidhate/avid-autofill/issues/new";

  function collectPii(profile) {
    const vals = [];
    const push = (v) => { const s = String(v == null ? "" : v).trim(); if (s.length >= 3) vals.push(s); };
    const p = (profile && profile.personal) || {};
    [p.firstName, p.lastName, p.fullName, p.preferredName, p.email, p.phone, p.address, p.city, p.postalCode].forEach(push);
    Object.values((profile && profile.links) || {}).forEach(push);
    return [...new Set(vals)].sort((a, b) => b.length - a.length);
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // The page as a blank form: typed values cleared, the extension's drawer and page
  // scripts removed, and the user's saved profile values redacted. `strict` (reports that
  // leave the device) also blanks hidden fields, which carry session tokens, and any email
  // address the page contains.
  function scrubbedHtml(profile, { strict = false } = {}) {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("#avid-autofill-root, script").forEach((n) => n.remove());
    clone.querySelectorAll("input").forEach((i) => {
      const t = (i.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox" || t === "radio") i.removeAttribute("checked");
      else if (!["submit", "button", "image", "reset"].includes(t)) i.setAttribute("value", "");
      else if (strict && t === "hidden") i.setAttribute("value", "");
    });
    clone.querySelectorAll("textarea").forEach((t) => { t.textContent = ""; });
    clone.querySelectorAll("option").forEach((o) => o.removeAttribute("selected"));
    let html = "<!doctype html>\n" + clone.outerHTML;
    for (const val of collectPii(profile)) html = html.replace(new RegExp(escapeRegExp(val), "gi"), "[REDACTED]");
    if (strict) html = html.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED-EMAIL]");
    return html;
  }

  const oneLine = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").replace(/--/g, "- -").trim();

  // The report file: a comment block of facts about the application, then the scrubbed page.
  // Only field labels and outcomes come from the fill result; the values filled are left out.
  function buildReport({ adapter, profile, fillReport, note }) {
    const manifest = (() => { try { return chrome.runtime.getManifest(); } catch (_) { return {}; } })();
    const page = new URL(location.href);
    const fields = document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea").length;
    const lines = [
      "Avid Autofill problem report",
      `Extension version: ${manifest.version || "unknown"}`,
      `Site recognized as: ${adapter && adapter.name ? adapter.name : "unknown"}`,
      `Page: ${page.origin}${page.pathname} (query string and fragment removed)`,
      `Frame: ${window === window.top ? "top page" : "embedded frame"}`,
      `Form fields on page: ${fields}`,
      `Browser: ${navigator.userAgent}`,
      `Captured: ${new Date().toISOString()}`,
      `What went wrong: ${oneLine(note) || "(not said)"}`,
    ];
    if (fillReport && Array.isArray(fillReport.results)) {
      lines.push(`Last fill: ${fillReport.filledCount || 0} filled, ${fillReport.results.length} matched`);
      for (const r of fillReport.results) lines.push(`  - ${oneLine(r.label).slice(0, 120)}: ${oneLine(r.status)}`);
    } else {
      lines.push("Last fill: Fill was not run on this page");
    }
    const ats = String((adapter && adapter.name) || "generic").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "generic";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    return {
      filename: `avid-report-${ats}-${stamp}.html`,
      text: `<!--\n${lines.join("\n")}\n-->\n${scrubbedHtml(profile, { strict: true })}`,
      subject: `Avid Autofill problem: ${adapter && adapter.name ? adapter.name : "unknown site"} (${page.hostname})`,
    };
  }

  // The link that opens a prefilled message. The file itself cannot ride along in a link,
  // so the body asks the user to attach what they just saved.
  function reportLink({ subject, filename, email = REPORT_EMAIL }) {
    const body = `Please attach the file ${filename} that was just saved to your Downloads folder, and add anything else that helps.`;
    if (email) return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return `${ISSUES_URL}?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  AvidAutofill.report = { REPORT_EMAIL, scrubbedHtml, buildReport, reportLink };
})();
