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
    const root = el.getRootNode();
    // 1. <label for=id>
    if (el.id) {
      const l = root.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (l) parts.push(l.textContent);
    }
    // 2. wrapping <label>
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent);
    // 3. aria-labelledby
    const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledby) {
      for (const id of labelledby.split(/\s+/)) {
        const n = root.getElementById(id);
        if (n) parts.push(n.textContent);
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
  }

  const CONTROLS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);
  function textWithoutControls(root) {
    let out = "";
    const walk = (n) => {
      for (const child of n.childNodes) {
        if (child.nodeType === 3) out += child.textContent;
        else if (child.nodeType === 1 && !CONTROLS.has(child.tagName)) walk(child);
      }
    };
    walk(root);
    return out.replace(/\s+/g, " ").trim();
  }

  // Text of the closest preceding block that looks like a question/label.
  function nearbyText(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      // Text of a container shared with other fields belongs to all of them, so
      // an ancestor holding several controls cannot name this one.
      if (node.querySelectorAll("input:not([type=hidden]), textarea, select").length > 1) break;
      // A field group container often holds the question text as its first text.
      // Read text nodes directly: cloning a number input that holds an
      // unparseable value logs a console error.
      const t = textWithoutControls(node);
      if (t.length > 2 && t.length < 220) return t;
    }
    return "";
  }

  // Question text for a radio group: its fieldset legend, else the text beside
  // the smallest element holding every radio (Lever puts the question in a
  // sibling block), else the first radio's own signal.
  function groupSignal(radios) {
    const legend = radios[0].closest("fieldset")?.querySelector("legend");
    if (legend && legend.textContent.trim()) return norm(legend.textContent);
    const title = groupTitle(radios);
    if (title) return title;
    let node = radios[0].parentElement;
    while (node && !radios.every((r) => node.contains(r))) node = node.parentElement;
    // A question written beside its choices (a span before the radio labels)
    // sits inside the smallest container, so read it before looking outward.
    if (node) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button, label").forEach((n) => n.remove());
      const inside = norm(clone.textContent);
      if (inside.length > 2 && inside.length < 300) return inside;
    }
    for (let i = 0; i < 4 && node && node.parentElement; i++, node = node.parentElement) {
      const text = Array.from(node.parentElement.childNodes)
        .filter((child) => child !== node)
        .map((child) => child.textContent)
        .join(" ");
      if (norm(text).length > 2) return norm(text).slice(0, 300);
    }
    return signalFor(radios[0]);
  }

  // The question label of a radio group wrapped in a fieldset or role=radiogroup
  // with no <legend> (Ashby): the first label in the group that is not one of the
  // options. Without it the sibling-text fallback below sweeps up neighbouring
  // questions and the group is answered as the wrong one.
  function groupTitle(radios) {
    const box = radios[0].closest('fieldset, [role="radiogroup"], [role="group"]');
    if (!box) return "";
    const named = norm(attr(box, "aria-label")) || fieldTitle(box);
    if (named) return named;
    const ids = new Set(radios.map((r) => r.id).filter(Boolean));
    const label = Array.from(box.querySelectorAll("label")).find(
      (l) => !ids.has(l.getAttribute("for")) && !l.querySelector("input") && norm(l.textContent)
    );
    return label ? norm(label.textContent) : "";
  }

  // Title of the form field entry holding a control (Ashby's data-field-path
  // wrapper). Comboboxes and button pairs have no label pointing at them, and
  // long questions overrun nearbyText's length cap.
  function fieldTitle(el) {
    const label = el.closest("[data-field-path]")?.querySelector("label, legend");
    return label ? norm(label.textContent) : "";
  }

  // Question text for a container of Yes/No buttons: the field title, else the
  // text around the buttons.
  function choiceSignal(container) {
    return fieldTitle(container) || norm(nearbyText(container) || container.getAttribute("aria-label"));
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
    const labelled = labelTextFor(el);
    const human = [
      labelled || fieldTitle(el),
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
    // Standard-attribute hints help on sites whose labels and names say nothing.
    const hint = AvidAutofill.generic ? AvidAutofill.generic.hints(el) : "";
    return norm([...human, ...ids, hint].filter(Boolean).join(" | "));
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
    { any: [/first name/, /given name/, /^fname$/, /legal first/, /(^|\| )first( \||$)/], not: [/preferred/], get: (p, h) => h.firstName() },
    { any: [/last name/, /family name/, /surname/, /^lname$/, /legal last/, /(^|\| )last( \||$)/], get: (p, h) => h.lastName() },
    { any: [/preferred (first )?name/, /nick ?name/, /goes by/, /name you('d| would) prefer/, /like us to call you/], get: (p) => p.personal.preferredName || p.personal.firstName },
    { any: [/legal name/, /full name/, /^name$/, /(^|\| )name(\*| \||$)/, /your name/, /candidate name/], not: [/company|user|file|first|last|middle|event|account|maiden|screen|pronounc|phonetic/], get: (p) => p.personal.fullName || `${p.personal.firstName} ${p.personal.lastName}`.trim() },

    // --- Contact ---
    { any: [/confirm.*e-?mail/, /e-?mail.*confirm/], not: [/company/], get: (p) => p.personal.email },
    { any: [/e-?mail/, /^email address$/], not: [/confirm|company/], get: (p) => p.personal.email },
    { any: [/phone device type/], kind: "select", get: (p) => p.personal.phoneDeviceType || "Mobile" },
    { any: [/phone/, /mobile/, /telephone/, /contact number/, /\bcell\b/], not: [/extension/, /device type/, /\bsms\b/, /opt.?in/, /phone code/, /country.*code/, /phonetic/], get: (p) => p.personal.phone },
    { any: [/\bpronouns?\b/], not: [/pronounc|pronunciation|phonetic/], get: (p) => p.personal.pronouns },

    // --- Address ---
    { any: [/(primary |permanent |current )?(residence|residential|home) address/, /address of (your )?(primary )?residence/], get: (p) => fullAddress(p.personal) },
    { any: [/street address/, /address line ?1/, /(^|\| )address( \||$)/, /mailing address/], not: [/email/], get: (p) => p.personal.address },
    { any: [/\bcity\b/, /\btown\b/, /(^|\| )(current )?location( \||$)/, /(^|\| )current location\b/, /\bwork location\b/, /where (are you|do you) (located|based|live)/], not: [/velocity|capacity|ethnic/], expand: "place", get: (p) => p.personal.city },
    { any: [/\bstate\b/, /\bprovince\b/, /\bregion\b/], not: [/statement|estate|united states|work/], expand: "usState", get: (p) => p.personal.state },
    { any: [/zip/, /postal code/, /post ?code/], get: (p) => p.personal.postalCode },
    { any: [/\bresident of\b/, /\bdo you (live|reside) in\b/], not: [/relocat|willing/], kind: "yesno", get: (p, h, signal) => residentOfState(signal, p.personal.state) },
    { any: [/\b(located|location|based|living|reside|residing) in\b/], not: [/relocat|willing|commut|authoriz|work|time ?zone|hours/], kind: "yesno", get: (p, h, signal) => inListedCountry(signal, p.personal.country) },
    // A second citizenship question offers "None" for the usual single one.
    { any: [/(second|dual|additional|other) (country of )?citizenship/, /citizenship in a second/], get: () => "None" },
    { any: [/citizenship/, /citizen of/, /nationality/], not: [/authoriz|sponsor|\bare you (a )?(u\.?s\.? )?citizen\b/], get: (p) => p.personal.citizenship || p.personal.country },
    { any: [/country/, /nationality/], not: [/authoriz/, /eligible to work/, /sponsor/, /work in the country/, /citizen/], get: (p) => p.personal.country },

    // --- Links ---
    { any: [/linkedin/], get: (p) => p.links.linkedin },
    { any: [/github/], not: [/contribution|repositor|project|describe|example/], get: (p) => p.links.github },
    { any: [/work samples?/, /samples? of (your )?work/, /examples? of (your )?work/], not: [/describe|explain|tell us/], get: (p) => p.links.portfolio || p.links.website || p.links.github },
    { any: [/portfolio/, /personal (web)?site/, /^website$/, /web ?site url/], get: (p) => p.links.portfolio || p.links.website },
    { any: [/twitter|(^| )x( |$)/], get: (p) => p.links.twitter },

    // --- Current role / employer ---
    { any: [/current company/, /current employer/, /present employer/, /(^|\| )company( \||$)/, /employer/], not: [/why|reason|previous|agreement|restriction/], get: (p, h) => h.work0().company },
    { any: [/current title/, /current role/, /job title/, /(^|\| )title( \||$)/, /current position/], not: [/mr\.?|mrs\.?|salutation/, /why|reason|leav|consider|looking for|seeking/], get: (p, h) => h.work0().title },

    // --- Education ---
    { any: [/which (university|college|school)/, /(university|college|school) (did|do) you (last )?(attend|graduate)/, /last attended/], get: (p, h) => h.edu0().school },
    { any: [/school/, /university/, /college/, /institution/], not: [/high school diploma\?/, /are you/, /current.*student/, /enrolled/, /graduation/, /anticipated/], get: (p, h) => h.edu0().school },
    { any: [/degree/], get: (p, h) => h.edu0().degree },
    { any: [/major/, /field of study/, /discipline/], get: (p, h) => h.edu0().field || h.edu0().degree },
    { any: [/\bgpa\b/, /grade point/], get: (p, h) => h.edu0().gpa },
    { any: [/graduation/, /grad(uation)? date/, /end date/, /expected graduation/], get: (p, h) => h.edu0().endDate },

    // --- Work authorization (yes/no) ---
    // Sponsorship before authorization: sponsorship questions often say "work
    // authorization", while "authorized ... without sponsorship" asks about authorization.
    { any: [/require\b.{0,40}\bsponsor/, /\bsponsor (you|me)\b/, /require sponsor/, /need sponsor/, /visa sponsor/, /sponsorship( now| in the future)?/], not: [/without (\w+ )?sponsor/], kind: "yesno", get: (p) => p.workAuth.requireSponsorship },
    { any: [/authoriz(ed|ation) to work/, /legally authorized/, /eligible to work/, /work authorization/], not: [/temporary/, /\bopt\b/, /\bcpt\b/, /practical training/], kind: "yesno", get: (p) => p.workAuth.authorizedToWork },

    // --- Logistics ---
    { any: [/salary/, /compensation expectation/, /desired (pay|salary|compensation)/, /expected salary/, /expected (annual |total )?(package|pay|compensation|ctc)/, /annual (package|compensation|pay)\b/, /(pay|compensation) (range|expectations?)/, /\bctc\b/], not: [/relocat|bonus eligib/], get: (p) => p.misc.salaryExpectation },
    // Notice period first: it is a length of time, unlike an earliest start date.
    { any: [/notice period/], duration: true, get: (p) => p.misc.noticePeriod || p.misc.earliestStartDate },
    { any: [/notice period/, /availability to start/, /when can you start/, /earliest start/, /start date/], get: (p) => p.misc.earliestStartDate || p.misc.noticePeriod },
    // General willingness only: a named destination or relocation assistance is a different question.
    { any: [/willing to relocate/, /open to relocat/, /relocat/], not: [/relocat\w* to \w/, /assistance|package|stipend|support/], kind: "yesno", get: (p) => p.misc.willingToRelocate },
    // In-office attendance ("This role is onsite ... willing to work from our local office?").
    { any: [/on-?site/, /in[- ]person/, /(work|working|come|commute|report)\w* (from|in|into|to|at)\b.{0,60}\boffice\b/], not: [/relocat/, /remote(ly)? (work|position|role)? ?only/], kind: "yesno", get: (p) => p.questions.willingOnsite },
    { any: [/on-?call/], kind: "yesno", get: (p) => p.questions.willingOnCall },
    { any: [/outside (work|employment|business|activit)/, /advisory (commitment|role|disclosure|position)/, /other (employment|jobs?) (commitments|outside)/, /moonlight/], kind: "yesno", get: (p) => p.questions.outsideEmployment },
    { any: [/security clearance/, /active clearance/, /\bclearance (level|status)\b/], alts: ["No", "N/A", "Not applicable", "I do not hold", "I don't hold"], get: (p) => p.questions.securityClearance },
    { any: [/work(ed|ing)? (in )?(a )?(fully )?remote/, /remote or hybrid/, /hybrid (work )?environment/], not: [/willing|open to|prefer/], get: (p) => p.questions.remoteExperience },
    { any: [/how did you (hear|find)/, /referral source/, /source/], not: [/open ?source/], get: (p) => p.misc.howHeard },
    { any: [/cover letter/], get: (p) => p.misc.coverLetter },
    { any: [/graduation date/, /anticipated graduation/, /expected graduation/, /grad(uation)? date/], get: (p, h) => p.misc.graduationDate || h.edu0().endDate },

    // --- Common yes/no application questions (Tesla-style legal/consent step) ---
    { any: [/(relatives?|family|friends?|close personal relationships?).*(employed|work(s|ing)?) (by|at|for|with)/, /(employed|work(s|ing)?) (by|at|for|with).*(relatives?|family members?)/, /related to (anyone|an employee|any employee)/], kind: "yesno", assumed: true, get: (p) => p.questions.relativesAtCompany },
    { any: [/previously (been )?employed/, /\bhave you (ever )?worked (at|for)\b/, /\bhave you (ever )?worked with (us|our company|this company)\b/, /currently or have you worked (at|for)/, /previously worked (here|for|at)/, /former employee/, /worked (here|for us) before/, /previous worker/], kind: "yesno", assumed: true, get: (p) => p.questions.previouslyEmployedHere },
    { any: [/intern or contractor/, /current or former (intern|contractor)/, /former\/current (intern|contractor)/, /contractor/], kind: "yesno", get: (p) => p.questions.formerContractorOrIntern },
    { any: [/current(ly)? (a )?(university |college )?student/, /currently enrolled/, /enrolled in an academic/, /pursuing a degree/], kind: "yesno", get: (p) => p.questions.currentStudent },
    { any: [/note ?taker/, /(record|transcrib)\w*.*(interview|conversation|call)/, /(interview|conversation|call).*(record|transcrib)\w*/], kind: "yesno", get: (p) => p.questions.consentToRecording },
    { any: [/text message/, /sms/, /consent to receiv/, /receive.*(notification|message)/], kind: "yesno", get: (p) => p.questions.consentToContact },
    { any: [/consider me for other/, /other (job )?opportunities/, /other (roles|positions)/, /additional (roles|positions|opportunities)/], kind: "yesno", get: (p) => p.questions.consentToOtherRoles },
    { any: [/at least 18/, /over 18/, /\b18 (years|or older)/, /age of majority/, /legally an adult/], kind: "yesno", get: (p) => p.questions.over18 },

    // A signature date on a form is the day it is filled in.
    { any: [/signature date/, /(^|\| )date( \||$)/], not: [/birth|start|end|graduat|availab|expir|issue/], get: (p, h, signal) => todayFor(signal) },

    // --- Voluntary self-ID (only fired when settings.fillEEO) ---
    { eeo: true, any: [/gender/, /gender identity/, /\bsex\b/], get: (p) => p.eeo.gender },
    { eeo: true, any: [/hispanic|latino/], not: [/\brace\b/], kind: "yesno", get: (p) => p.eeo.hispanicLatino },
    { eeo: true, any: [/race|ethnicit/], get: (p) => p.eeo.race },
    { eeo: true, any: [/veteran/], expand: "veteran", get: (p) => p.eeo.veteranStatus },
    { eeo: true, any: [/disabilit/], expand: "disability", get: (p) => p.eeo.disabilityStatus },
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

  // Self-ID dropdowns word their options as sentences ("I am not a protected
  // veteran"), so a short saved answer also tries the common sentence forms.
  function selfIdAlternates(kind, value) {
    const v = norm(value);
    const no = /^(no|none|not|non)\b/.test(v) || /\bnot\b/.test(v) && !/decline|prefer/.test(v);
    const decline = /decline|prefer not|do not wish|don't wish|not to (answer|say|disclose)/.test(v);
    const noun = kind === "veteran" ? "veteran" : "disability";
    if (decline) return ["i decline to self-identify", "i do not wish to answer", "i do not want to answer", "i prefer not to answer", "i choose not to disclose", "decline to self-identify", "prefer not to answer"];
    if (no) return kind === "veteran" ? ["i am not a protected veteran", "not a protected veteran", "i am not a veteran", "no"] : ["no, i do not have a disability", "i do not have a disability", "no"];
    if (/^(yes|y)$/.test(v) || v.includes("protected") || v.includes("have a")) return kind === "veteran" ? ["i am a protected veteran", "i identify as one or more of the classifications of protected veteran", "yes"] : ["yes, i have a disability", "yes, i have a disability, or have had one in the past", "yes"];
    return [];
  }

  // "City, State" spellings for location autocompletes, full state name first,
  // so a search for the city does not settle on a same-named city elsewhere.
  function placeAlternates(city, profile) {
    const state = String(profile.personal.state || "").trim();
    if (!state) return [];
    const names = [state, ...stateAlternates(state)].sort((a, b) => b.length - a.length);
    return names.map((name) => `${city}, ${name}`);
  }

  // Country names from the browser's own region list plus common short forms,
  // so "are you located in Canada, UK or Poland?" can be answered.
  let countryNames;
  function countriesIn(text) {
    if (!countryNames) {
      const names = new Intl.DisplayNames(["en"], { type: "region" });
      countryNames = [["uk", "GB"], ["great britain", "GB"], ["england", "GB"], ["usa", "US"], ["u.s.a", "US"], ["america", "US"]];
      for (let a = 65; a < 91; a++) {
        for (let b = 65; b < 91; b++) {
          const code = String.fromCharCode(a, b), name = names.of(code);
          if (name && name !== code) countryNames.push([norm(name), code]);
        }
      }
    }
    const has = (name) => new RegExp(`(^|[^a-z])${name.replace(/[.]/g, "\\.")}([^a-z]|$)`).test(text);
    return new Set(countryNames.filter(([name]) => has(name)).map(([, code]) => code));
  }
  // "Yes" when the question names the applicant's country, "No" when it names
  // only other countries and nothing that could be theirs ("US", a US state).
  function inListedCountry(signal, country) {
    const own = [...countriesIn(norm(country))][0];
    if (!own) return null;
    const text = Object.keys(US_STATES).reduce((t, state) => t.replace(new RegExp(`\\b${state}\\b`, "g"), " "), signal);
    const named = countriesIn(text);
    if (named.has(own)) return "Yes";
    if (!named.size || /\bu\.?s\b/.test(text)) return null;
    return "No";
  }

  // Today's date in the order the field's placeholder shows (default month/day/year).
  function todayFor(signal) {
    const d = new Date(), y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    if (/yyyy-mm-dd/.test(signal)) return `${y}-${m}-${day}`;
    if (/dd\/mm\/yyyy/.test(signal)) return `${day}/${m}/${y}`;
    return `${m}/${day}/${y}`;
  }
  function fullAddress(personal) {
    const stateZip = [personal.state, personal.postalCode].filter(Boolean).join(" ");
    return [personal.address, personal.city, stateZip, personal.country].filter(Boolean).join(", ");
  }
  // True for a question a yes/no answer can answer: it opens with an auxiliary
  // verb in some line of its text and does not ask where, which, what, when or how.
  function looksYesNo(signal) {
    return /(^|\| )(are|do|does|did|have|has|will|would|can|could|is|was|were)\b/.test(signal) && !/\b(where|which|what|when|how)\b/.test(signal);
  }

  // "Yes" when the question names the applicant's state, "No" when it names
  // only other states, null when it names none or the profile has no state.
  function residentOfState(signal, state) {
    const v = norm(state);
    const own = US_STATES[v] ? v : Object.keys(US_STATES).find((name) => US_STATES[name].toLowerCase() === v);
    if (!own) return null;
    const named = Object.keys(US_STATES).filter((name) => new RegExp(`\\b${name}\\b`).test(signal));
    if (!named.length) return null;
    return named.includes(own) ? "Yes" : "No";
  }

  // A length of time as a [low, high] range in weeks: "2 weeks" -> [2, 2],
  // "3-4 weeks" -> [3, 4], "3+ months" -> [13, Infinity], "Immediately" -> [0, 0].
  const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, twelve: 12, a: 1, an: 1 };
  const UNIT_WEEKS = { day: 1 / 7, week: 1, month: 52 / 12, year: 52 };
  function durationWeeks(text) {
    const t = norm(text).replace(/\b(one|two|three|four|five|six|eight|twelve|an?)\b(?= ?(\+|or more)? ?(days?|weeks?|months?|years?))/g, (w) => WORD_NUMBERS[w]);
    if (/\b(immediate(ly)?|right away|asap|none|no notice|n\/a)\b/.test(t)) return [0, 0];
    const m = t.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(\+|or more)?\s*(day|week|month|year)s?/);
    if (!m) return null;
    const unit = UNIT_WEEKS[m[4]];
    const low = Number(m[1]) * unit;
    return [low, m[3] ? Infinity : (m[2] ? Number(m[2]) : Number(m[1])) * unit];
  }
  // Index of the option whose time range sits nearest the profile's, or -1.
  function nearestDuration(value, labels) {
    const want = durationWeeks(value);
    if (!want) return -1;
    let best = -1, bestGap = Infinity;
    labels.forEach((label, i) => {
      const range = durationWeeks(label);
      if (!range) return;
      const gap = Math.max(0, range[0] - want[1], want[0] - range[1]);
      if (gap < bestGap - 1e-9) { best = i; bestGap = gap; }
    });
    return bestGap <= 1 ? best : -1;
  }

  // "If yes, please provide details ..." follows a yes/no question but is free text.
  const FOLLOW_UP = /^if (yes|so|you answered|applicable)\b|\b(provide|explain|describe|list|specify)\b.{0,30}\b(details|detail|explanation|more)\b/;

  // Return { value, alts, kind, eeo, place } for a signal, or null if no rule matches.
  function match(signal, profile, helpers) {
    for (const rule of RULES) {
      if (rule.not && rule.not.some((re) => re.test(signal))) continue;
      if (rule.any.some((re) => re.test(signal))) {
        if (rule.kind === "yesno" && FOLLOW_UP.test(signal)) continue;
        const value = rule.get(profile, helpers, signal);
        if (value == null || value === "") return null;
        // "None" clearance reads as "No" on a yes/no control, and so on.
        const alts = rule.expand === "veteran" || rule.expand === "disability" ? selfIdAlternates(rule.expand, value) : rule.expand === "usState" ? stateAlternates(value) : rule.expand === "place" ? placeAlternates(value, profile) : /^none$/i.test(value) ? rule.alts || [] : [];
        return { value: String(value), alts, duration: !!rule.duration, kind: rule.kind || "text", eeo: !!rule.eeo, assumed: !!rule.assumed, place: rule.expand === "place" };
      }
    }
    return null;
  }

  AvidAutofill.labelTextFor = labelTextFor;
  AvidAutofill.matcher = { signalFor, groupSignal, choiceSignal, match, looksYesNo, nearestDuration, makeHelpers: P, norm, deCamel };
})();
