// Shared profile schema + storage helpers.
// Loaded in BOTH the content-script world and the options/popup pages,
// so it must be plain script (no ES module import/export) and attach to globalThis.
(function () {
  const g = globalThis;
  const AvidAutofill = (g.AvidAutofill = g.AvidAutofill || {});

  // Canonical shape of a stored profile. Every field the matcher can target
  // has a home here. Keep keys stable — the matcher resolvers reference them.
  AvidAutofill.DEFAULT_PROFILE = {
    personal: {
      firstName: "",
      lastName: "",
      fullName: "",
      preferredName: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States",
      pronouns: "",
    },
    links: {
      linkedin: "",
      github: "",
      portfolio: "",
      website: "",
      twitter: "",
    },
    // Most-recent-first. Index 0 is used for single "current employer" fields.
    work: [
      // { company, title, location, startDate, endDate, current, description }
    ],
    education: [
      // { school, degree, field, location, startDate, endDate, gpa }
    ],
    // Voluntary self-ID. Blank = leave untouched (the safe default).
    eeo: {
      gender: "",
      race: "",
      hispanicLatino: "",
      veteranStatus: "",
      disabilityStatus: "",
    },
    workAuth: {
      // Free-text 'Yes'/'No' — matched against Yes/No selects, radios, checkboxes.
      authorizedToWork: "Yes",
      requireSponsorship: "No",
    },
    misc: {
      salaryExpectation: "",
      noticePeriod: "",
      earliestStartDate: "",
      graduationDate: "",
      willingToRelocate: "Yes",
      howHeard: "",
      coverLetter: "",
      // Freeform Q&A the matcher falls back to for open-ended questions (phase 2 / AI).
      customAnswers: {},
    },
    // Common yes/no application questions. Defaults are conservative; edit in
    // the options page. Blank = leave the field untouched.
    questions: {
      previouslyEmployedHere: "No",
      formerContractorOrIntern: "No",
      currentStudent: "",
      consentToContact: "Yes",
      consentToOtherRoles: "Yes",
      agreeToTerms: "Yes",
      over18: "Yes",
    },
    meta: {
      importedAt: "",
      source: "",
    },
  };

  const STORAGE_KEY = "avidProfile";
  const SETTINGS_KEY = "avidSettings";

  AvidAutofill.DEFAULT_SETTINGS = {
    overwriteFilled: false, // if true, replace values already present in a field
    fillEEO: false, // opt-in: only fill voluntary self-ID when explicitly enabled
    highlightFilled: true, // briefly outline fields we touched
  };

  // Deep-merge a stored partial over the defaults so new schema keys always exist.
  function mergeDefaults(defaults, stored) {
    if (Array.isArray(defaults)) return stored != null ? stored : defaults;
    if (defaults && typeof defaults === "object") {
      const out = {};
      for (const k of Object.keys(defaults)) {
        out[k] = mergeDefaults(defaults[k], stored ? stored[k] : undefined);
      }
      // preserve any extra stored keys (e.g. customAnswers entries)
      if (stored && typeof stored === "object") {
        for (const k of Object.keys(stored)) {
          if (!(k in out)) out[k] = stored[k];
        }
      }
      return out;
    }
    return stored !== undefined ? stored : defaults;
  }

  AvidAutofill.getProfile = async function () {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return mergeDefaults(AvidAutofill.DEFAULT_PROFILE, data[STORAGE_KEY]);
  };

  AvidAutofill.saveProfile = async function (profile) {
    await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  };

  // Resume is stored separately from the profile: { name, type, dataUrl }.
  // dataUrl is a base64 data: URL so a File can be reconstructed in the page.
  const RESUME_KEY = "avidResume";

  AvidAutofill.getResume = async function () {
    const data = await chrome.storage.local.get(RESUME_KEY);
    return data[RESUME_KEY] || null;
  };
  AvidAutofill.saveResume = async function (resume) {
    await chrome.storage.local.set({ [RESUME_KEY]: resume });
  };
  AvidAutofill.clearResume = async function () {
    await chrome.storage.local.remove(RESUME_KEY);
  };
  AvidAutofill.RESUME_KEY = RESUME_KEY;

  AvidAutofill.getSettings = async function () {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return mergeDefaults(AvidAutofill.DEFAULT_SETTINGS, data[SETTINGS_KEY]);
  };

  AvidAutofill.saveSettings = async function (settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  };

  AvidAutofill.STORAGE_KEY = STORAGE_KEY;
  AvidAutofill.SETTINGS_KEY = SETTINGS_KEY;
  AvidAutofill.mergeDefaults = mergeDefaults;
})();
