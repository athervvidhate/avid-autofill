// Initial AI fallback owns only unmatched native controls. Custom dropdowns and
// repeaters keep using their existing adapters.
(function () {
  const A = globalThis.AvidAutofill = globalThis.AvidAutofill || {};
  const blocked = /gender|\bsex\b|race|ethnic|disabilit|veteran|hispanic|latino|consent|certif|acknowledg|\bagree\b|terms|privacy|signature|social security|\bssn\b|captcha|password|\bsearch\b|\bfilter\b/;
  const visible = el => el?.isConnected && !el.disabled && !el.readOnly && el.getAttribute("aria-hidden") !== "true" && (el.offsetParent !== null || el.getClientRects().length > 0);
  function describe(candidate, id) {
    const { el, group } = candidate;
    if (!visible(el) || blocked.test(candidate.signal)) return null;
    const type = group ? "radio" : el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.type;
    if (!["text", "textarea", "email", "tel", "url", "select", "radio"].includes(type) || el.getAttribute("role") === "spinbutton" || el.getAttribute("role") === "combobox") return null;
    if (group ? group.some(r => r.checked) : !!el.value) return null;
    const label = (candidate.signal || "").slice(0, 1200);
    if (!label.trim()) return null;
    let options;
    if (group) options = Object.fromEntries(group.map((radio, i) => [`o${i}`, A.labelTextFor(radio).trim() || radio.value]).filter(([, label]) => label && label.length <= 500));
    else if (type === "select") options = Object.fromEntries(Array.from(el.options).map((option, i) => [`o${i}`, option]).filter(([, option]) => !option.disabled && !option.parentElement.disabled && option.value && option.textContent.trim() && option.textContent.trim().length <= 500).map(([id, option]) => [id, option.textContent.trim()]));
    if (options && (!Object.keys(options).length || Object.keys(options).length > 100)) return null;
    return { id, label, type, ...(options ? { options } : {}) };
  }
  function fingerprint({ el, group }) {
    if (group) {
      const current = A.fillers.queryAll('input[type="radio"]').filter(r => r.name === el.name && visible(r));
      if (current.length !== group.length || current.some((r, i) => r !== group[i])) return "changed-radio-group";
    }
    return JSON.stringify({
      limits: [el.name, el.id, el.maxLength, el.minLength, el.pattern, el.required],
      choices: group ? group.map(r => [r.value, r.disabled, A.labelTextFor(r)]) : el.options ? Array.from(el.options).map(o => [o.value, o.textContent, o.disabled, !!o.parentElement.disabled]) : null,
    });
  }
  async function fill(candidates, profile, run) {
    const url = location.href, root = document.documentElement;
    const pending = candidates.map((candidate, i) => ({ ...candidate, field: describe(candidate, `f${i}`), fingerprint: fingerprint(candidate) })).filter(candidate => candidate.field);
    const report = { results: [], aiMessage: "" };
    if (!pending.length) return report;
    // shortcut: cap one user-initiated fill at 20 fields; add batching after live evaluation.
    const batch = pending.slice(0, 20);
    for (const candidate of pending.slice(20)) report.results.push({ label: candidate.field.label, value: "", status: "ai-limit" });
    let response;
    try { response = await chrome.runtime.sendMessage({ type: "AVID_JEV_FILL", fields: batch.map(candidate => candidate.field) }); }
    catch { response = { ok: false, error: "Jev is unavailable. Reload the extension and application page." }; }
    const valid = response?.ok && Array.isArray(response.results) && response.results.length === batch.length && response.results.every(result => result && typeof result.id === "string" && batch.some(candidate => candidate.field.id === result.id)) && new Set(response.results.map(result => result.id)).size === batch.length;
    if (!valid) {
      report.aiMessage = response?.error || "Jev returned an invalid result. No AI answers were applied.";
      report.results.push(...batch.map(candidate => ({ label: candidate.field.label, value: "", status: "ai-unavailable" })));
      return report;
    }
    const fresh = location.href === url && document.documentElement === root && A._fillRun === run && JSON.stringify(await A.getProfile()) === JSON.stringify(profile) && (await A.getSettings()).jevEnabled;
    for (const candidate of batch) {
      const { field, el, group } = candidate, result = response.results.find(result => result.id === field.id);
      const record = (status, value = "") => report.results.push({ label: field.label, value, status, method: "jev", reason: result.sourceQuestion || "" });
      if (!fresh || location.href !== url || document.documentElement !== root || A._fillRun !== run) { record("ai-stale"); continue; }
      const live = describe({ ...candidate, signal: group ? groupSignal(group[0]) : A.matcher.signalFor(el) }, field.id);
      if (!live) { record(group?.some(r => r.checked) || el.value ? "kept-existing" : "ai-stale"); continue; }
      if (JSON.stringify(live) !== JSON.stringify(field) || fingerprint(candidate) !== candidate.fingerprint) { record("ai-stale"); continue; }
      if (result.status !== "fill") { record(result.status === "ai-incompatible" ? result.status : "ai-needs-answer"); continue; }
      if (typeof result.value !== "string" || !result.value.trim()) { record("ai-incompatible"); continue; }
      try {
        if (field.options) {
          if (!Object.hasOwn(field.options, result.optionId)) { record("ai-incompatible"); continue; }
          const index = Number(result.optionId.slice(1));
          if (group) {
            const radio = group[index];
            if (!visible(radio)) { record("ai-stale"); continue; }
            const ok = A.fillers.setRadio([radio], radio.value);
            record(ok && radio.checked ? "filled" : "skipped", field.options[result.optionId]);
          } else {
            const option = el.options[index];
            if (Array.from(el.options).filter(o => o.value === option.value).length !== 1) { record("ai-incompatible"); continue; }
            const ok = A.fillers.setNativeSelect(el, [option.value]);
            record(ok && el.selectedIndex === index ? "filled" : "skipped", field.options[result.optionId]);
          }
        } else {
          const probe = el.cloneNode(false); probe.value = result.value;
          if (probe.value !== result.value || (el.maxLength >= 0 && result.value.length > el.maxLength) || (el.minLength > 0 && result.value.length < el.minLength) || !probe.checkValidity()) { record("ai-incompatible"); continue; }
          A.fillers.setTextValue(el, result.value);
          record(el.value === result.value && el.checkValidity() ? "filled" : "skipped", result.value);
        }
      } catch { record("error"); }
    }
    const count = report.results.filter(result => result.method === "jev" && result.status === "filled").length;
    report.aiMessage = `Jev filled ${count} extra ${count === 1 ? "field" : "fields"}. Review every AI-filled answer before submitting.`;
    return report;
  }
  function groupSignal(el) { return A.matcher.norm(el.closest("fieldset")?.querySelector("legend")?.textContent || A.matcher.signalFor(el)); }
  A.jevContent = { fill };
})();
