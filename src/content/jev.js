// AI fallback for controls the rules left unmatched: native text, select and
// radio controls, and custom dropdowns whose input names its own listbox.
// Repeaters keep using their existing adapters.
(function () {
  const A = globalThis.AvidAutofill = globalThis.AvidAutofill || {};
  const blocked = /gender|\bsex\b|race|ethnic|disabilit|veteran|hispanic|latino|consent|certif|acknowledg|\bagree\b|terms|privacy|signature|social security|\bssn\b|captcha|password|\bsearch\b|\bfilter\b/;
  const visible = el => el?.isConnected && !el.disabled && !el.readOnly && el.getAttribute("aria-hidden") !== "true" && (el.offsetParent !== null || el.getClientRects().length > 0);
  const answered = ({ el, group, custom, buttons }) => buttons ? buttons.some(b => b.getAttribute("aria-pressed") === "true") : custom ? !!A.fillers.customValue(el) : group ? group.some(r => r.checked) : !!el.value;
  // Drop repeated label fragments, select placeholders and generated IDs
  // ("question 123", "cards 1c719ca9 ... field0").
  const clean = signal => [...new Set(String(signal || "").split(" | ").map(part => part.trim()).filter(part => part && !/^(select\.*|question \d+)$/.test(part) && !/[0-9a-f]{8}/.test(part)))].join(" | ");
  function describe(candidate, id) {
    const { el, group, custom, buttons } = candidate;
    if (!visible(el) || blocked.test(candidate.signal)) return null;
    const type = custom ? "select" : buttons ? "radio" : group ? "radio" : el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.type;
    if (!custom && !buttons && (!["text", "textarea", "email", "tel", "url", "select", "radio"].includes(type) || el.getAttribute("role") === "spinbutton" || el.getAttribute("role") === "combobox")) return null;
    if (answered(candidate)) return null;
    const label = clean(candidate.signal).slice(0, 1200);
    if (!label.trim()) return null;
    let options;
    if (custom) options = Object.fromEntries((candidate.choices || []).map((label, i) => [`o${i}`, label]).filter(([, label]) => label.length <= 500));
    else if (buttons) options = Object.fromEntries(buttons.map((b, i) => [`o${i}`, b.textContent.trim()]));
    else if (group) options = Object.fromEntries(group.map((radio, i) => [`o${i}`, A.labelTextFor(radio).trim() || radio.value]).filter(([, label]) => label && label.length <= 500));
    else if (type === "select") options = Object.fromEntries(Array.from(el.options).map((option, i) => [`o${i}`, option]).filter(([, option]) => !option.disabled && !option.parentElement.disabled && option.value && option.textContent.trim() && option.textContent.trim().length <= 500).map(([id, option]) => [id, option.textContent.trim()]));
    if (options && Object.keys(options).length > 100) return null;
    // A dropdown whose options could not be read is still a question for the
    // applicant: describe it without options so it is listed, never sent to Jev.
    if (options && !Object.keys(options).length) return custom ? { id, label, type, unreadable: true } : null;
    return { id, label, type, ...(options ? { options } : {}) };
  }
  function fingerprint(candidate) {
    const { el, group } = candidate;
    if (candidate.buttons) return JSON.stringify(candidate.buttons.map(b => [b.textContent, b.disabled]));
    if (group) {
      const current = A.fillers.queryAll('input[type="radio"]').filter(r => r.name === el.name && visible(r));
      if (current.length !== group.length || current.some((r, i) => r !== group[i])) return "changed-radio-group";
    }
    return JSON.stringify({
      limits: [el.name, el.id, el.maxLength, el.minLength, el.pattern, el.required],
      choices: candidate.custom ? candidate.choices : group ? group.map(r => [r.value, r.disabled, A.labelTextFor(r)]) : el.options ? Array.from(el.options).map(o => [o.value, o.textContent, o.disabled, !!o.parentElement.disabled]) : null,
    });
  }
  // Fields Jev left for the applicant in the latest fill, by field ID, so the
  // drawer can save the answer they give on the page to the question bank.
  let unanswered = new Map();
  const NEEDS_APPLICANT = ["ai-needs-answer", "ai-unavailable", "ai-incompatible", "ai-limit"];
  function questionText(candidate) {
    const { el, group, custom, buttons } = candidate;
    const text = group || buttons ? "" : A.labelTextFor(custom ? inner(el) : el);
    return (text.replace(/\s+/g, " ").trim() || clean(candidate.signal).split(" | ")[0]).replace(/\s*\*$/, "").slice(0, 500);
  }
  function currentAnswer({ el, group, custom, buttons }) {
    if (buttons) return buttons.find(b => b.getAttribute("aria-pressed") === "true")?.textContent.trim() || "";
    if (custom) return A.fillers.customValue(el);
    if (group) { const radio = group.find(r => r.checked); return radio ? (A.labelTextFor(radio).trim() || radio.value) : ""; }
    if (el.tagName === "SELECT") return el.value ? el.options[el.selectedIndex].textContent.trim() : "";
    return el.value.trim();
  }
  // { question, answer } for a field left for the applicant, or null.
  function answerFor(fieldId) {
    const candidate = unanswered.get(fieldId);
    return candidate && candidate.el.isConnected ? { question: questionText(candidate), answer: currentAnswer(candidate) } : null;
  }
  // Save the answer the applicant confirmed, if the page still shows it.
  async function saveAnswer(fieldId, answer, anySite) {
    const current = answerFor(fieldId);
    if (!current || current.answer !== answer) throw new Error("The answer on the page changed. Click Save again.");
    const response = await chrome.runtime.sendMessage({ type: "AVID_JEV_SAVE_ANSWER", question: current.question, answer, anySite });
    if (!response?.ok) throw new Error(response?.error || "Avid could not save the answer.");
  }
  async function fill(candidates, profile, run) {
    const url = location.href, root = document.documentElement;
    unanswered = new Map();
    // Custom dropdowns list their options only while open: read them once now.
    for (const candidate of candidates) {
      if (candidate.custom && visible(candidate.el) && !blocked.test(candidate.signal) && !answered(candidate)) candidate.choices = await A.fillers.customOptions(candidate.el);
    }
    const pending = candidates.map((candidate, i) => ({ ...candidate, field: describe(candidate, `f${i}`), fingerprint: fingerprint(candidate) })).filter(candidate => candidate.field);
    const report = { results: [], aiMessage: "" };
    if (!pending.length) return report;
    const unreadable = pending.filter(candidate => candidate.field.unreadable);
    for (const candidate of unreadable) { unanswered.set(candidate.field.id, candidate); report.results.push({ label: candidate.field.label, value: "", status: "ai-needs-answer", field: candidate.field.id }); }
    const sendable = pending.filter(candidate => !candidate.field.unreadable);
    if (!sendable.length) { report.aiMessage = "Jev could not read the options for some dropdowns. Answer them on the page, then save them to your question bank."; return report; }
    // shortcut: cap one user-initiated fill at 20 fields; add batching after live evaluation.
    const batch = sendable.slice(0, 20);
    for (const candidate of sendable.slice(20)) { unanswered.set(candidate.field.id, candidate); report.results.push({ label: candidate.field.label, value: "", status: "ai-limit", field: candidate.field.id }); }
    let response;
    try { response = await chrome.runtime.sendMessage({ type: "AVID_JEV_FILL", fields: batch.map(candidate => candidate.field) }); }
    catch { response = { ok: false, error: "Jev is unavailable. Reload the extension and application page." }; }
    const valid = response?.ok && Array.isArray(response.results) && response.results.length === batch.length && response.results.every(result => result && typeof result.id === "string" && batch.some(candidate => candidate.field.id === result.id)) && new Set(response.results.map(result => result.id)).size === batch.length;
    if (!valid) {
      report.aiMessage = response?.error || "Jev returned an invalid result. No AI answers were applied.";
      for (const candidate of batch) unanswered.set(candidate.field.id, candidate);
      report.results.push(...batch.map(candidate => ({ label: candidate.field.label, value: "", status: "ai-unavailable", field: candidate.field.id })));
      return report;
    }
    const fresh = location.href === url && document.documentElement === root && A._fillRun === run && JSON.stringify(await A.getProfile()) === JSON.stringify(profile) && (await A.getSettings()).jevEnabled;
    for (const candidate of batch) {
      const { field, el, group, custom, buttons } = candidate, result = response.results.find(result => result.id === field.id);
      const record = (status, value = "") => {
        if (NEEDS_APPLICANT.includes(status)) unanswered.set(field.id, candidate);
        report.results.push({ label: field.label, value, status, method: "jev", reason: result.sourceQuestion || "", ...(NEEDS_APPLICANT.includes(status) ? { field: field.id } : {}) });
      };
      if (!fresh || location.href !== url || document.documentElement !== root || A._fillRun !== run) { record("ai-stale"); continue; }
      const live = describe({ ...candidate, signal: buttons ? A.matcher.choiceSignal(buttons[0].parentElement) : group ? A.matcher.groupSignal(group) : A.matcher.signalFor(custom ? inner(el) : el) }, field.id);
      if (!live) { record(answered(candidate) ? "kept-existing" : "ai-stale"); continue; }
      if (JSON.stringify(live) !== JSON.stringify(field) || fingerprint(candidate) !== candidate.fingerprint) { record("ai-stale"); continue; }
      if (result.status !== "fill") { record(result.status === "ai-incompatible" ? result.status : "ai-needs-answer"); continue; }
      if (typeof result.value !== "string" || !result.value.trim()) { record("ai-incompatible"); continue; }
      try {
        if (field.options) {
          if (!Object.hasOwn(field.options, result.optionId)) { record("ai-incompatible"); continue; }
          const index = Number(result.optionId.slice(1));
          if (custom) {
            const label = field.options[result.optionId];
            const ok = await A.fillers.setReactSelect(el, [label], { exact: true });
            record(ok && A.matcher.norm(A.fillers.customValue(el)) === A.matcher.norm(label) ? "filled" : "skipped", label);
          } else if (buttons) {
            const label = field.options[result.optionId];
            const ok = A.fillers.setButtonChoice(buttons, label);
            record(ok ? "filled" : "skipped", label);
          } else if (group) {
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
    report.aiMessage = count
      ? `Jev filled ${count} extra ${count === 1 ? "field" : "fields"}. Review every AI-filled answer before submitting.`
      : "Jev found no saved answer for the remaining fields. Answers you save to your question bank can be reused.";
    return report;
  }
  const inner = el => el.matches("input") ? el : el.querySelector("input") || el;
  A.jevContent = { fill, answerFor, saveAnswer };
})();
