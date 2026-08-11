// ATS adapters. The generic engine handles native inputs/selects/radios on any
// page; adapters add two things: (1) a friendly name so the UI can tell you which
// ATS was detected, and (2) selectors for that ATS's *custom* (non-native)
// dropdowns, which need the click-open-type-pick dance in fillers.setReactSelect.
//
// Phase 1 ships Greenhouse, Lever, Ashby (clean DOM). Workday / iCIMS / Taleo /
// Workable are stubbed with detection only — their fill logic needs live-page
// testing before it's trustworthy, so they currently fall through to generic.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const ADAPTERS = [
    {
      name: "Greenhouse",
      detect: () =>
        /greenhouse\.io|grnh\.se/.test(location.host) ||
        /boards\.greenhouse/.test(location.href) ||
        !!document.querySelector('#application_form, [id^="job_application"]'),
      // Greenhouse uses react-select for department/location/custom dropdowns.
      customSelectSelectors: ['[class*="select__control"]'],
    },
    {
      name: "Lever",
      detect: () =>
        /lever\.co|jobs\.lever/.test(location.host) ||
        !!document.querySelector(".application-form, [data-qa='application-form']"),
      // Lever mostly uses native <select>; keep a selector in case of custom ones.
      customSelectSelectors: ['[class*="select__control"]'],
    },
    {
      name: "Ashby",
      detect: () =>
        /ashbyhq\.com|jobs\.ashby/.test(location.host) ||
        !!document.querySelector('[class*="_container_"] form, [data-highlight="ashby"]'),
      // Ashby uses ARIA comboboxes.
      customSelectSelectors: ['[role="combobox"]', '[class*="_select_"]'],
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
    // --- Detection-only stubs (phase 2 fill logic) ---
    {
      name: "iCIMS",
      stub: true,
      detect: () => /icims\.com/.test(location.host),
      customSelectSelectors: [],
    },
    {
      name: "Taleo",
      stub: true,
      detect: () => /taleo\.net|tbe\.taleo/.test(location.host),
      customSelectSelectors: [],
    },
    {
      name: "Workable",
      stub: true,
      detect: () =>
        /workable\.com|apply\.workable/.test(location.host) ||
        !!document.querySelector('[data-ui="application-form"]'),
      customSelectSelectors: ['[class*="styles__select"]'],
    },
  ];

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

  AvidAutofill.adapters = { detect, ADAPTERS };
})();
