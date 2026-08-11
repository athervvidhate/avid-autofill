// Field-to-profile matching. Given a form element, gather every text signal
// (label, name, id, placeholder, aria-label, nearby text), then run an ordered
// rules table: first rule whose pattern matches the signal wins and returns the
// profile value to fill. Order matters — put specific rules before generic ones.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  const norm = (s) =>
    String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();

  // Resolve the human-readable label associated with a form control.
  function labelTextFor(el) {
    const parts = [];
    // 1. <label for=id>
    if (el.id) {
      const l = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (l) parts.push(l.textContent);
    }
    // 2. wrapping <label>
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent);
    // 3. aria-labelledby
    const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledby) {
      for (const id of labelledby.split(/\s+/)) {
        const n = document.getElementById(id);
        if (n) parts.push(n.textContent);
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
  }

  // Text of the closest preceding block that looks like a question/label.
  function nearbyText(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      // A field group container often holds the question text as its first text.
      const clone = node.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((n) =>
        n.remove()
      );
      const t = clone.textContent.replace(/\s+/g, " ").trim();
      if (t.length > 2 && t.length < 220) return t;
    }
    return "";
  }

  // Turn camelCase / snake_case / kebab-case identifiers into spaced words so
  // attribute-based ids (Workday's data-automation-id="legalNameSection_firstName",
  // React name="urls[LinkedIn]") match the same rules as human labels.
  function deCamel(s) {
    return String(s || "")
      .replace(/[_\-.\[\]]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  }

  const attr = (el, name) => (el.getAttribute && el.getAttribute(name)) || "";

  // Aggregate signal string used for matching. Human-readable sources are used
  // as-is; identifier-like attributes are de-camelCased first.
  function signalFor(el) {
    const human = [
      labelTextFor(el),
      attr(el, "aria-label"),
      el.placeholder,
      nearbyText(el),
    ];
    const ids = [
      el.name,
      el.id,
      attr(el, "data-automation-id"),
      attr(el, "data-qa"),
      attr(el, "autocomplete"),
    ].map(deCamel);
    return norm([...human, ...ids].filter(Boolean).join(" | "));
  }

  // Helpers reading from the profile.
  const P = (profile) => ({
    firstName: () =>
      profile.personal.firstName ||
      (profile.personal.fullName || "").split(" ")[0],
    lastName: () =>
      profile.personal.lastName ||
      (profile.personal.fullName || "").split(" ").slice(1).join(" "),
    work0: () => profile.work[0] || {},
    edu0: () => profile.education[0] || {},
  });

  // Each rule: { any:[regex], not:[regex], get:(profile,helpers)=>string, kind }.
  // `kind` hints the filler (text | yesno | select). Default text.
  const RULES = [
    // --- Name ---
    { any: [/first name/, /given name/, /^fname$/, /legal first/], get: (p, h) => h.firstName() },
    { any: [/last name/, /family name/, /surname/, /^lname$/, /legal last/], get: (p, h) => h.lastName() },
    { any: [/preferred name/, /nick ?name/, /goes by/], get: (p) => p.personal.preferredName || p.personal.firstName },
    { any: [/legal name/, /full name/, /^name$/, /your name/, /candidate name/], not: [/company|user|file|first|last|event|account/], get: (p) => p.personal.fullName || `${p.personal.firstName} ${p.personal.lastName}`.trim() },

    // --- Contact ---
    { any: [/e-?mail/, /^email address$/], not: [/confirm|company/], get: (p) => p.personal.email },
    { any: [/phone/, /mobile/, /telephone/, /contact number/], get: (p) => p.personal.phone },
    { any: [/pronoun/], get: (p) => p.personal.pronouns },

    // --- Address ---
    { any: [/street address/, /address line ?1/, /^address$/, /mailing address/], not: [/email/], get: (p) => p.personal.address },
    { any: [/city/, /town/], not: [/velocity|capacity/], get: (p) => p.personal.city },
    { any: [/\bstate\b/, /\bprovince\b/, /\bregion\b/], not: [/statement|estate|united states|work/], expand: "usState", get: (p) => p.personal.state },
    { any: [/zip/, /postal code/, /post code/], get: (p) => p.personal.postalCode },
    { any: [/country/, /nationality/], not: [/authoriz/, /eligible to work/, /sponsor/, /work in the country/, /citizen/], get: (p) => p.personal.country },

    // --- Links ---
    { any: [/linkedin/], get: (p) => p.links.linkedin },
    { any: [/github/], get: (p) => p.links.github },
    { any: [/portfolio/, /personal (web)?site/, /^website$/, /web ?site url/], get: (p) => p.links.portfolio || p.links.website },
    { any: [/twitter|(^| )x( |$)/], get: (p) => p.links.twitter },

    // --- Current role / employer ---
    { any: [/current company/, /current employer/, /present employer/, /^company$/, /employer/], not: [/why|reason|previous/], get: (p, h) => h.work0().company },
    { any: [/current title/, /current role/, /job title/, /^title$/, /current position/], not: [/mr\.?|mrs\.?|salutation/], get: (p, h) => h.work0().title },

    // --- Education ---
    { any: [/school/, /university/, /college/, /institution/], not: [/high school diploma\?/, /are you/, /current.*student/, /enrolled/, /graduation/, /anticipated/], get: (p, h) => h.edu0().school },
    { any: [/degree/], get: (p, h) => h.edu0().degree },
    { any: [/major/, /field of study/, /discipline/], get: (p, h) => h.edu0().field || h.edu0().degree },
    { any: [/\bgpa\b/, /grade point/], get: (p, h) => h.edu0().gpa },
    { any: [/graduation/, /grad(uation)? date/, /end date/, /expected graduation/], get: (p, h) => h.edu0().endDate },

    // --- Work authorization (yes/no) ---
    { any: [/authoriz(ed|ation) to work/, /legally authorized/, /eligible to work/, /work authorization/], kind: "yesno", get: (p) => p.workAuth.authorizedToWork },
    { any: [/require sponsor/, /need sponsor/, /visa sponsor/, /sponsorship( now| in the future)?/], kind: "yesno", get: (p) => p.workAuth.requireSponsorship },

    // --- Logistics ---
    { any: [/salary/, /compensation expectation/, /desired (pay|salary|compensation)/, /expected salary/], get: (p) => p.misc.salaryExpectation },
    { any: [/notice period/, /availability to start/, /when can you start/, /earliest start/, /start date/], get: (p) => p.misc.earliestStartDate || p.misc.noticePeriod },
    { any: [/willing to relocate/, /open to relocat/, /relocat/], kind: "yesno", get: (p) => p.misc.willingToRelocate },
    { any: [/how did you (hear|find)/, /referral source/, /source/], not: [/open ?source/], get: (p) => p.misc.howHeard },
    { any: [/cover letter/], get: (p) => p.misc.coverLetter },
    { any: [/graduation date/, /anticipated graduation/, /expected graduation/, /grad(uation)? date/], get: (p, h) => p.misc.graduationDate || h.edu0().endDate },

    // --- Common yes/no application questions (Tesla-style legal/consent step) ---
    { any: [/previously (been )?employed/, /previously worked (here|for|at)/, /former employee/, /worked (here|for us) before/], kind: "yesno", get: (p) => p.questions.previouslyEmployedHere },
    { any: [/intern or contractor/, /current or former (intern|contractor)/, /former\/current (intern|contractor)/, /contractor/], kind: "yesno", get: (p) => p.questions.formerContractorOrIntern },
    { any: [/current(ly)? (a )?(university |college )?student/, /currently enrolled/, /enrolled in an academic/, /pursuing a degree/], kind: "yesno", get: (p) => p.questions.currentStudent },
    { any: [/text message/, /sms/, /consent to receiv/, /receive.*(notification|message)/], kind: "yesno", get: (p) => p.questions.consentToContact },
    { any: [/consider me for other/, /other (job )?opportunities/, /other (roles|positions)/, /additional (roles|positions|opportunities)/], kind: "yesno", get: (p) => p.questions.consentToOtherRoles },
    { any: [/at least 18/, /over 18/, /\b18 (years|or older)/, /age of majority/, /legally an adult/], kind: "yesno", get: (p) => p.questions.over18 },
    { any: [/i have read/, /read and understand/, /i certify/, /i acknowledge/, /i agree/, /accept.*(terms|conditions|agreement)/, /conditions of employment/], kind: "yesno", get: (p) => p.questions.agreeToTerms },

    // --- Voluntary self-ID (only fired when settings.fillEEO) ---
    { eeo: true, any: [/gender/, /gender identity/], get: (p) => p.eeo.gender },
    { eeo: true, any: [/hispanic|latino/], kind: "yesno", get: (p) => p.eeo.hispanicLatino },
    { eeo: true, any: [/race|ethnicit/], get: (p) => p.eeo.race },
    { eeo: true, any: [/veteran/], get: (p) => p.eeo.veteranStatus },
    { eeo: true, any: [/disabilit/], get: (p) => p.eeo.disabilityStatus },
  ];

  // US state <-> abbreviation, so a "CA" profile fills a "California" dropdown
  // and vice-versa. Populated both directions.
  const US_STATES = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
    colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
    kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
    missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
    oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
    wyoming: "WY", "district of columbia": "DC",
  };
  const ABBR_TO_STATE = Object.fromEntries(
    Object.entries(US_STATES).map(([full, ab]) => [ab, titleCase(full)])
  );
  function titleCase(s) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function stateAlternates(value) {
    const v = String(value).trim();
    if (/^[A-Za-z]{2}$/.test(v) && ABBR_TO_STATE[v.toUpperCase()]) {
      return [ABBR_TO_STATE[v.toUpperCase()]];
    }
    const ab = US_STATES[v.toLowerCase()];
    return ab ? [ab] : [];
  }

  // Return { value, alts, kind, eeo } for a signal, or null if no rule matches.
  function match(signal, profile, helpers) {
    for (const rule of RULES) {
      if (rule.not && rule.not.some((re) => re.test(signal))) continue;
      if (rule.any.some((re) => re.test(signal))) {
        const value = rule.get(profile, helpers);
        if (value == null || value === "") return null;
        const alts = rule.expand === "usState" ? stateAlternates(value) : [];
        return { value: String(value), alts, kind: rule.kind || "text", eeo: !!rule.eeo };
      }
    }
    return null;
  }

  AvidAutofill.labelTextFor = labelTextFor;
  AvidAutofill.matcher = { signalFor, match, makeHelpers: P, norm, deCamel };
})();
