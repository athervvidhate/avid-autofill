// Low-level DOM fillers. The whole point of this file is that
// `element.value = x` does NOT work on React/Vue-controlled inputs — the
// framework's internal value tracker overrides it on the next render. We use
// the prototype's native value setter and then dispatch the real events the
// framework listens for.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;
  const nativeSelectSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value"
  ).set;

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function flash(el) {
    if (!AvidAutofill._highlight) return;
    const prev = el.style.outline;
    el.style.outline = "2px solid #4f7cff";
    el.style.outlineOffset = "1px";
    setTimeout(() => {
      el.style.outline = prev;
    }, 1200);
  }

  // Set a text-like input/textarea. Workday (and other strict React forms) only
  // register values that arrive through the real browser input pipeline — a
  // native-setter + synthetic `input` event leaves their internal state empty, so
  // required-field validation still fails even though the value is visible. So we
  // prefer document.execCommand("insertText"), which fires genuine
  // beforeinput/InputEvent that React's value tracker accepts. Native setter is
  // the fallback for anything that rejects execCommand.
  function setTextValue(el, value) {
    el.focus();
    el.dispatchEvent(new Event("focus", { bubbles: true }));

    // Select any existing content so insertText replaces rather than appends.
    try {
      if (typeof el.setSelectionRange === "function") {
        el.setSelectionRange(0, (el.value || "").length);
      } else {
        el.select && el.select();
      }
    } catch (_) {}

    let inserted = false;
    try {
      // execCommand replaces the selection we made above with the value, firing
      // the real input pipeline. Treat it as successful if the field ended up
      // non-empty (masked fields may reformat, so we don't require an exact match).
      inserted = document.execCommand("insertText", false, value) && !!el.value;
    } catch (_) {
      inserted = false;
    }

    if (!inserted) {
      const setter =
        el.tagName === "TEXTAREA" ? nativeTextareaSetter : nativeInputSetter;
      setter.call(el, "");
      setter.call(el, value);
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })
      );
    }

    // Workday validates required fields on blur; fire change + blur to clear the
    // "field is required" error the same way tabbing out of the field would.
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.blur();
    flash(el);
  }

  function normalize(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  // Native <select>: match by exact value/text across any candidate, then by
  // contains. `values` may be a single string or a list of acceptable values.
  function setNativeSelect(el, values) {
    const targets = toList(values);
    if (!targets.length) return false;
    let matched = null;
    for (const opt of el.options) {
      const v = normalize(opt.value);
      const t = normalize(opt.textContent);
      if (targets.some((tg) => v === tg || t === tg)) {
        matched = opt;
        break;
      }
    }
    if (!matched) {
      for (const opt of el.options) {
        const t = normalize(opt.textContent);
        if (t && targets.some((tg) => t.includes(tg) || tg.includes(t))) {
          matched = opt;
          break;
        }
      }
    }
    if (!matched) return false;
    nativeSelectSetter.call(el, matched.value);
    fireInput(el);
    flash(el);
    return true;
  }

  function toList(v) {
    return (Array.isArray(v) ? v : [v]).map(normalize).filter(Boolean);
  }

  // Radio group: find the input whose label/value best matches `value`.
  function setRadio(inputs, value) {
    const target = normalize(value);
    for (const el of inputs) {
      const labelText = normalize(AvidAutofill.labelTextFor(el));
      const v = normalize(el.value);
      if (v === target || labelText === target) {
        clickChoice(el);
        return true;
      }
    }
    for (const el of inputs) {
      const labelText = normalize(AvidAutofill.labelTextFor(el));
      if (labelText && (labelText.includes(target) || target.includes(labelText))) {
        clickChoice(el);
        return true;
      }
    }
    return false;
  }

  function setCheckbox(el, shouldCheck) {
    if (el.checked !== shouldCheck) {
      clickChoice(el);
    }
    return true;
  }

  function clickChoice(el) {
    el.focus();
    el.click();
    // Some frameworks need the change event even after click.
    el.dispatchEvent(new Event("change", { bubbles: true }));
    flash(el);
  }

  // Custom dropdowns: react-select, Ashby ARIA comboboxes, and Workday
  // button-listboxes. Open the control, optionally type to filter, then click the
  // matching option. Options render in a portal, so we search the whole document.
  // Returns a Promise<boolean>.
  async function setReactSelect(control, values) {
    const targets = toList(values);
    if (!targets.length) return false;
    const typed = targets[0];
    control.scrollIntoView({ block: "center" });

    // The opener is an inner input/combobox, else the control itself (Workday
    // dropdowns are a bare <button>).
    const opener =
      control.querySelector("input") ||
      control.querySelector('[role="combobox"], [class*="control"]') ||
      control;
    opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    opener.click();
    await sleep(150);

    // Type into a filter box if one exists (react-select inner input, or
    // Workday's separate searchBox rendered in the popup).
    const typeInput =
      control.querySelector("input") ||
      document.querySelector('input[data-automation-id="searchBox"]');
    if (typeInput) {
      typeInput.focus();
      setTextValue(typeInput, typed);
      await sleep(240);
    }

    const optText = (o) =>
      normalize(o.getAttribute("data-automation-label") || o.textContent);
    const options = Array.from(
      document.querySelectorAll(
        '[data-automation-id="promptOption"], [class*="option"], [role="option"], li[id*="option"]'
      )
    ).filter((o) => o.offsetParent !== null);

    let pick =
      options.find((o) => targets.some((t) => optText(o) === t)) ||
      options.find((o) => targets.some((t) => optText(o).includes(t))) ||
      (typeInput ? options[0] : null);

    if (!pick) {
      if (typeInput) {
        typeInput.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Enter", keyCode: 13 })
        );
        return true;
      }
      return false;
    }
    pick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    pick.click();
    flash(control);
    return true;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Reconstruct a File from a stored { name, type, dataUrl } and hand it to the
  // page. `input.files` is a read-only FileList, so we go through DataTransfer —
  // the only sanctioned way to set files programmatically. Then dispatch the
  // events the ATS listens for so its own upload handler (S3, etc.) fires.
  async function buildFile(resume) {
    const res = await fetch(resume.dataUrl);
    const blob = await res.blob();
    return new File([blob], resume.name, {
      type: resume.type || blob.type || "application/octet-stream",
    });
  }

  async function uploadToInput(input, resume) {
    const file = await buildFile(resume);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    flash(input);
    return true;
  }

  // Drag-and-drop zones with no reachable <input type=file>: fire a synthetic
  // drop carrying the file. Works on many react-dropzone implementations.
  async function dropOnZone(zone, resume) {
    const file = await buildFile(resume);
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ["dragenter", "dragover", "drop"]) {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true });
      // DragEvent.dataTransfer is read-only; define it on the instance.
      Object.defineProperty(ev, "dataTransfer", { value: dt });
      zone.dispatchEvent(ev);
    }
    flash(zone);
    return true;
  }

  AvidAutofill.fillers = {
    setTextValue,
    setNativeSelect,
    setRadio,
    setCheckbox,
    setReactSelect,
    uploadToInput,
    dropOnZone,
    normalize,
    sleep,
  };
})();
