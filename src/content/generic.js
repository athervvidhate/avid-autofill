// Support for job sites Avid has no adapter for: extra matching hints taken from
// standard HTML attributes, and a detector that decides whether the current page
// holds a job application form so the drawer can be offered there.
(function () {
  const A = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  // WHATWG autocomplete tokens, spelled the way the matcher's rules expect.
  const AUTOCOMPLETE = {
    "given-name": "first name", "additional-name": "middle name", "family-name": "last name",
    name: "full name", email: "email", tel: "phone", "tel-national": "phone",
    "street-address": "street address", "address-line1": "street address",
    "address-level2": "city", "address-level1": "state", "postal-code": "postal code",
    country: "country", "country-name": "country", organization: "current company",
    "organization-title": "current title", url: "website",
  };
  const TYPE = { email: "email", tel: "phone" };

  // Words from the control's autocomplete token and input type. Pages with
  // meaningless names and labels ("field_17") often still set these.
  function hints(el) {
    const out = [];
    const token = String((el.getAttribute && el.getAttribute("autocomplete")) || "").toLowerCase().split(/\s+/).pop();
    if (AUTOCOMPLETE[token]) out.push(AUTOCOMPLETE[token]);
    const type = String(el.type || "").toLowerCase();
    if (TYPE[type]) out.push(TYPE[type]);
    return out.join(" ");
  }

  // Signals that a field belongs to a job application rather than any form.
  const IDENTITY = {
    name: /first name|last name|full name|given name|family name|surname|legal name|^name\b|\| name\b/,
    email: /e-?mail/,
    phone: /phone|mobile|telephone|\bcell\b/,
  };
  const JOB_FIELD = /resume|\bcv\b|curriculum vitae|cover letter|linkedin|work authori[sz]ation|authori[sz]ed to work|sponsorship|how did you (hear|find)|salary|notice period|years of experience|portfolio|github|current (company|employer)|desired start|relocat/;
  const JOB_CUE = /\b(apply|application|applying|career|careers|job|jobs|position|opening|vacanc(y|ies)|recruit|hiring|candidate)\b/i;
  const SUBMIT = /^(submit|send)( my| your)? application$|^apply( now| for this (job|position|role))?$|^submit$/i;

  function visible(el) {
    return !!el && !el.disabled && el.type !== "hidden" && el.getAttribute("aria-hidden") !== "true" &&
      (el.offsetParent !== null || el.getClientRects().length > 0);
  }

  // Score the page's form fields. An application needs the basics a candidate
  // always gives (two of name, email, phone) plus something only a job form asks
  // for (a resume upload or a job question), or a resume upload with page cues.
  function detect(root = document) {
    const matcher = A.matcher;
    // File inputs are usually hidden behind a styled button, so they skip the visibility check.
    const fields = A.fillers.queryAll("input, textarea, select", root).filter((el) =>
      el.type === "file" ? !el.disabled : visible(el));
    if (!fields.length) return { isApplication: false, score: 0, reasons: [] };

    const found = new Set();
    let resume = false, jobFields = 0, password = false;
    for (const el of fields) {
      if (el.closest("#avid-autofill-root, #avid-tracker-root")) continue;
      const type = String(el.type || "").toLowerCase();
      if (type === "password") { password = true; continue; }
      const signal = matcher.signalFor(el) + (type === "file" ? " " + (el.accept || "") : "");
      if (type === "file") {
        if (/resume|\bcv\b|curriculum vitae/.test(signal) || /\.pdf|\.docx?/.test(signal)) resume = true;
        continue;
      }
      for (const [key, re] of Object.entries(IDENTITY)) if (re.test(signal)) found.add(key);
      if (JOB_FIELD.test(signal)) jobFields++;
    }
    const heading = [...document.querySelectorAll("h1, h2, title")].map((n) => n.textContent).join(" ");
    const cue = JOB_CUE.test(`${location.pathname.replaceAll("/", " ")} ${location.search} ${heading}`);
    const submit = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
      .some((n) => SUBMIT.test((n.textContent || n.value || "").trim().replace(/\s+/g, " ")));

    const identity = found.size;
    const reasons = [];
    let score = identity;
    if (resume) { score += 3; reasons.push("resume upload"); }
    if (jobFields) { score += Math.min(jobFields, 3); reasons.push("job questions"); }
    if (cue) { score += 1; reasons.push("job page"); }
    if (submit) { score += 1; reasons.push("apply button"); }
    // A login or sign-up form (a password field next to the email) is not an application.
    const loginOnly = password && !resume && jobFields === 0;
    const isApplication = !loginOnly && ((identity >= 2 && (resume || jobFields >= 1 || (cue && submit))) || (identity >= 1 && resume && cue));
    return { isApplication, score, reasons };
  }

  A.generic = { hints, detect };
})();
