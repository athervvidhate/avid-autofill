// ATS adapters. The generic engine handles native inputs/selects/radios on any
// page; adapters add two things: (1) a friendly name so the UI can tell you which
// ATS was detected, and (2) selectors for that ATS's *custom* (non-native)
// dropdowns, which need the click-open-type-pick dance in fillers.setReactSelect.
//
// Greenhouse, Lever, Ashby, SmartRecruiters, Workable, iCIMS, Taleo, Oracle
// Recruiting, SuccessFactors, BambooHR, Rippling and Jobvite name the platform,
// detect it by host or by markup, and add that platform's custom-dropdown
// selectors to the generic engine. Workday is a beta adapter with its own date
// and repeater passes. Breezy, Recruitee, JazzHR, Teamtailor and Paylocity are
// detection-only stubs.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const ADAPTERS = [
    {
      name: "SmartRecruiters",
      host: /smartrecruiters\.com/,
      detect: () => /(^|\.)smartrecruiters\.com$/.test(location.hostname) || !!document.querySelector("oc-app-root"),
      customSelectSelectors: ['[role="combobox"]'],
    },
    {
      name: "Greenhouse",
      host: /greenhouse\.io|grnh\.se/,
      detect: () =>
        /greenhouse\.io|grnh\.se/.test(location.host) ||
        /boards\.greenhouse/.test(location.href) ||
        !!document.querySelector('#application_form, [id^="job_application"]'),
      // Greenhouse uses react-select for department/location/custom dropdowns.
      customSelectSelectors: ['[class*="select__control"]'],
    },
    {
      name: "Breezy",
      stub: true,
      detect: () => /breezy\.hr/.test(location.host),
      customSelectSelectors: [],
    },
    {
      name: "Lever",
      host: /lever\.co|jobs\.lever/,
      detect: () =>
        /lever\.co|jobs\.lever/.test(location.host) ||
        !!document.querySelector(".application-form, [data-qa='application-form']"),
      // Lever mostly uses native <select>; keep a selector in case of custom ones.
      customSelectSelectors: ['[class*="select__control"]'],
      // Searches places as you type; only a picked suggestion counts.
      locationSearch: "input.location-input",
    },
    {
      name: "Ashby",
      detect: () =>
        /ashbyhq\.com|jobs\.ashby/.test(location.host) ||
        !!document.querySelector('[class*="ashby-application-form"], [data-highlight="ashby"]'),
      // Ashby uses ARIA comboboxes.
      customSelectSelectors: ['[role="combobox"]', '[class*="_select_"]'],
      // An uploaded resume starts Ashby's own parse, which rewrites the form when
      // it finishes. Wait for the parse to start (if it does) and to end.
      async resumeParse(sleep) {
        // The "Parsing your resume" layer is data-state="hidden" while idle.
        const pending = () => {
          const layer = document.querySelector(".ashby-application-form-autofill-input-pending-layer");
          return !!layer && layer.getAttribute("data-state") !== "hidden";
        };
        let started = false;
        for (let i = 0; i < 15 && !started; i++) { await sleep(200); started = !!pending(); }
        if (!started) return;
        for (let i = 0; i < 150 && pending(); i++) await sleep(200);
        await sleep(600);
      },
    },
    {
      name: "Workday",
      beta: true,
      detect: () =>
        /myworkdayjobs\.com|workday\.com/.test(location.host) ||
        !!document.querySelector('[data-automation-id="jobApplication"], [data-automation-id="applyFlowPage"]'),
      // Workday dropdowns (incl. yes/no questions) are button-listboxes.
      customSelectSelectors: [
        'button[aria-haspopup="listbox"]',
        'button[data-automation-id="selectinput"]',
        '[data-automation-id="multiSelectContainer"]',
      ],
      // Typeable MM/DD/YYYY date sections handled by the workday date module.
      hasDateSections: true,
    },
    {
      name: "Workable",
      host: /(^|\.)workable\.com$/,
      detect: () =>
        /(^|\.)workable\.com$/.test(location.host) ||
        !!document.querySelector('[data-ui="application-form"]'),
      // Workable's phone country code and EEO answers are ARIA comboboxes.
      customSelectSelectors: ['[class*="styles__select"]', '[role="combobox"]'],
    },
    {
      name: "iCIMS",
      host: /(^|\.)icims\.com$/,
      detect: () =>
        /(^|\.)icims\.com$/.test(location.host) ||
        !!document.querySelector("#iCIMS_MainWrapper, .iCIMS_MainWrapper, iframe#icims_content_iframe"),
      // iCIMS forms are native tables of inputs and selects; the application
      // itself loads inside an iframe that main.js reaches through the service worker.
      customSelectSelectors: [],
    },
    {
      name: "Taleo",
      host: /(^|\.)taleo\.net$/,
      detect: () =>
        /(^|\.)taleo\.net$/.test(location.host) ||
        !!document.querySelector("#requisitionDescriptionInterface, #taleoContent, form[action*='.ftl']"),
      // Legacy Taleo is native HTML; the newer Oracle-hosted flow uses comboboxes.
      customSelectSelectors: ['[role="combobox"]'],
    },
    {
      name: "Oracle Recruiting",
      host: /oraclecloud\.com/,
      detect: () =>
        (/(^|\.)oraclecloud\.com$/.test(location.host) && /CandidateExperience|hcmUI/i.test(location.pathname)) ||
        !!document.querySelector("apply-flow-form, [class*='apply-flow'], oj-select-single, oj-input-text[class*='apply']"),
      // Oracle JET renders selects as oj-select-single / oj-combobox-one.
      customSelectSelectors: ["oj-select-single", "oj-combobox-one", '[role="combobox"]'],
    },
    {
      name: "SuccessFactors",
      host: /successfactors\.(com|eu)|sapsf\.(com|eu)/,
      detect: () =>
        /(^|\.)(successfactors|sapsf)\.(com|eu)$/.test(location.host) ||
        !!document.querySelector("#fbclc_userName, form[action*='career?company'], [id^='fbclc_']"),
      // UI5 comboboxes sit beside plain inputs on the career-site apply flow.
      customSelectSelectors: ['.sapMComboBox', '[role="combobox"]'],
    },
    {
      name: "BambooHR",
      host: /(^|\.)bamboohr\.com$/,
      detect: () =>
        /(^|\.)bamboohr\.com$/.test(location.host) ||
        !!document.querySelector(".ResAts, .ApplicationForm, [data-fabric-component]"),
      // BambooHR's fabric selects are buttons that open a listbox.
      customSelectSelectors: ['button.fab-SelectToggle', '[role="combobox"]'],
    },
    {
      name: "Rippling",
      host: /(^|\.)rippling\.com$/,
      detect: () => /^ats\.rippling\.com$/.test(location.host),
      customSelectSelectors: ['[role="combobox"]', '[class*="select__control"]'],
    },
    {
      name: "Jobvite",
      host: /(^|\.)jobvite\.com$/,
      detect: () =>
        /(^|\.)jobvite\.com$/.test(location.host) ||
        !!document.querySelector(".jv-page-body, form.jv-form, [class^='jv-']"),
      customSelectSelectors: ['[role="combobox"]'],
    },
    // --- Detection-only stubs ---
    {
      name: "Recruitee",
      stub: true,
      detect: () => /recruitee\.com/.test(location.host),
      customSelectSelectors: [],
    },
    {
      name: "JazzHR",
      stub: true,
      detect: () => /applytojob\.com|jazz\.co/.test(location.host),
      customSelectSelectors: [],
    },
    {
      name: "Teamtailor",
      stub: true,
      detect: () => /teamtailor\.com/.test(location.host),
      customSelectSelectors: [],
    },
    {
      name: "Paylocity",
      stub: true,
      detect: () => /paylocity\.com/.test(location.host),
      customSelectSelectors: [],
    },
  ];

  // SmartRecruiters lists every screening question, with its choices, in the
  // `definition` attribute of the form's host element and draws the form in that
  // host's shadow tree. A control there carries its question's id in an id, name
  // or other attribute of itself or an ancestor, so its question can be read
  // from the definition even when the drawn label cannot be.
  const definitions = new WeakMap();
  function screeningQuestions() {
    const out = [];
    for (const host of document.querySelectorAll("sr-screening-questions-form[definition]")) {
      const raw = host.getAttribute("definition");
      let cached = definitions.get(host);
      if (!cached || cached.raw !== raw) {
        let questions = [];
        try { questions = JSON.parse(raw).questions || []; } catch (_) { /* malformed definition: no questions */ }
        cached = { raw, questions: questions.filter((q) => q && typeof q.id === "string" && q.id.length >= 8 && q.label) };
        definitions.set(host, cached);
      }
      out.push(...cached.questions);
    }
    return out;
  }

  // Labels are Markdown: "Are you a protected veteran? [(definitions)](https://...)".
  const plainText = (md) => String(md).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#`>]+/g, " ").replace(/\s+/g, " ").trim();

  // { id, label, option } for the screening question a control answers, where
  // `option` is the label of the choice a radio or checkbox stands for; or null.
  function siteQuestion(el) {
    const questions = screeningQuestions();
    if (!questions.length) return null;
    for (let node = el; node; node = node.assignedSlot || node.parentElement || (node.parentNode && node.parentNode.host) || null) {
      for (const { value } of node.attributes || []) {
        const q = value.length >= 8 && questions.find((question) => value.includes(question.id));
        if (!q) continue;
        const choices = (q.fields || q.questionsFields || []).flatMap((f) => f.values || f.questionsFieldValues || []);
        const choice = /^(radio|checkbox)$/.test(el.type) && choices.find((c) => c.fieldValue === el.value || c.id === el.value);
        return { id: q.id, label: plainText(q.label), option: choice ? plainText(choice.label) : "" };
      }
    }
    return null;
  }

  function detect() {
    for (const a of ADAPTERS) {
      try {
        if (a.detect()) return a;
      } catch (_) {
        /* selector errors are non-fatal */
      }
    }
    return { name: "Generic", customSelectSelectors: ['[class*="select__control"]', '[role="combobox"]'] };
  }

  // True when the adapter was picked from the page's markup alone, on a host that
  // is not the platform's own. Generic class names and ids can appear on any site,
  // so such a match still has to look like a job application.
  function markupOnly(adapter) {
    return !!adapter.host && !adapter.host.test(location.host + location.href);
  }

  AvidAutofill.adapters = { detect, markupOnly, siteQuestion, ADAPTERS };
})();
