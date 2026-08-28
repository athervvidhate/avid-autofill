// Pick the frame that should receive a popup-triggered fill.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  function maxFields(items) {
    return items.reduce(
      (best, item) => (!best || item.result.fields > best.result.fields ? item : best),
      null
    );
  }

  function selectTarget(injections) {
    const loaded = injections.filter((item) => item.result);
    if (!loaded.length) return null;

    const recognized = loaded.filter((item) => item.result.ats !== "Generic");
    const recognizedWithFields = recognized.filter((item) => item.result.fields > 0);
    const anyWithFields = loaded.filter((item) => item.result.fields > 0);
    const best =
      maxFields(recognizedWithFields) ||
      maxFields(anyWithFields) ||
      recognized[0] ||
      loaded[0];

    return { frameId: best.frameId, ...best.result };
  }

  AvidAutofill.popup = { ...(AvidAutofill.popup || {}), selectTarget };
})();
