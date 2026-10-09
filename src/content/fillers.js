// Low-level DOM fillers. The whole point of this file is that
// `element.value = x` does NOT work on React/Vue-controlled inputs — the
// framework's internal value tracker overrides it on the next render. We use
// the prototype's native value setter and then dispatch the real events the
// framework listens for.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  // Native selectors stop at shadow boundaries. Keep extension UI out of fills.
  function queryAll(selector, root = document) {
    const matches = Array.from(root.querySelectorAll(selector));
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot && !["avid-autofill-root", "avid-tracker-root"].includes(host.id)) {
        matches.push(...queryAll(selector, host.shadowRoot));
      }
    }
    return matches;
  }

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
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
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
        new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value })
      );
    }

    // Workday validates required fields on blur; fire change + blur to clear the
    // "field is required" error the same way tabbing out of the field would.
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.blur();
    flash(el);
  }

  // Type into a dropdown's filter without firing change/blur. Workday closes
  // typeahead prompts on blur, so the option list must stay open until the
  // matching option has been clicked.
  function setSearchValue(el, value) {
    el.focus();
    try {
      if (typeof el.setSelectionRange === "function") {
        el.setSelectionRange(0, (el.value || "").length);
      }
    } catch (_) {}

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, value) && !!el.value;
    } catch (_) {
      inserted = false;
    }
    if (!inserted) {
      nativeInputSetter.call(el, "");
      nativeInputSetter.call(el, value);
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value })
      );
    }
    flash(el);
  }

  // Workday's date sections are role="spinbutton" inputs, NOT text inputs: the
  // committed value lives in aria-valuenow + a display node, and `.value` stays
  // empty/transient even when the field holds a value. setTextValue is wrong for
  // them — its `.value`-based success check is unreliable, and its native-setter
  // fallback assigns `.value` directly, which the spinbutton's React handler
  // ignores, leaving a field that looks filled but validates as empty ("required").
  // So type through execCommand (the real input pipeline Workday honors) and never
  // touch `.value` or fall back to the native setter. This function does not
  // dispatch an extra blur. The caller finishes the date by blurring the final
  // spinner once.
  function setDateSpinner(el, value) {
    el.focus();
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    try {
      if (typeof el.setSelectionRange === "function") {
        el.setSelectionRange(0, (el.value || "").length);
      }
    } catch (_) {}
    try {
      document.execCommand("insertText", false, String(value));
    } catch (_) {}
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    flash(el);
    const expected = String(Number(value));
    return (
      el.getAttribute("aria-valuenow") === expected ||
      el.getAttribute("aria-valuetext") === expected
    );
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
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    flash(el);
  }

  // Custom dropdowns: react-select, Ashby ARIA comboboxes, and Workday
  // button-listboxes. Open the control, optionally type to filter, then click the
  // matching option. Options render in a portal, so we search the whole document.
  // Returns a Promise<boolean>.
  async function setReactSelect(control, values, config) {
    const targets = toList(values);
    if (!targets.length) return false;
    const typed = targets[0];
    if (typeof control.scrollIntoView === "function") {
      control.scrollIntoView({ block: "center" });
    }

    // Press the control the way a pointer click does. React-select (Greenhouse)
    // ignores a lone mousedown or click on its inner input.
    press(control);
    await sleep(150);

    // Type into a filter box if one exists (react-select inner input, or
    // Workday's separate searchBox rendered in the popup).
    const typeInput =
      (control.matches("input") && control) ||
      control.querySelector("input") ||
      document.querySelector('input[data-automation-id="searchBox"]');
    if (typeInput) {
      typeInput.focus();
      setSearchValue(typeInput, typed);
      await sleep(240);
    }

    const optText = (o) =>
      normalize(o.getAttribute("data-automation-label") || o.textContent);
    let pick = null;
    // Options render in a portal. When the opener names its listbox, look only
    // there, so hidden lists elsewhere on the page (phone country codes) are ignored.
    const listboxId = typeInput && typeInput.getAttribute("aria-controls");
    const findOption = () => {
      const listbox = listboxId && document.getElementById(listboxId);
      const visible = Array.from(
        queryAll(
          '[data-automation-id="promptOption"], [class*="option"], [role="option"], li[id*="option"]',
          listbox || undefined
        )
      ).filter(
        (o) => o.offsetParent !== null || o.getClientRects().length > 0
      );
      // A wrapper whose class mentions "option" holds every option's text, so it
      // would match any target and a click on it lands on whichever option the
      // list has highlighted (the first). Only innermost elements are options.
      const available = visible.filter((o) => !visible.some((c) => c !== o && o.contains(c)));
      // Exact text for any target first; otherwise the earliest (most specific)
      // target that some option contains.
      return (
        available.find((o) => targets.some((t) => optText(o) === t)) ||
        (config && config.exact ? null : targets.map((t) => available.find((o) => optText(o).includes(t))).find(Boolean)) ||
        null
      );
    };
    for (let attempt = 0; attempt < 8 && !pick; attempt++) {
      pick = findOption();
      if (pick) {
        // The list re-renders while a typed search resolves, and a node found
        // mid-render can end up showing a different option when it is clicked.
        // Click only an option that is still the match after the list settles.
        await sleep(120);
        const again = findOption();
        if (!again || !pick.isConnected || again !== pick || optText(again) !== optText(pick)) pick = null;
      }
      if (!pick && typeInput && attempt < 7) await sleep(150);
    }
    // Workday's search prompts (skills, field of study) list matches only after
    // Enter runs the search.
    if (!pick && typeInput && config && config.searchOnEnter) {
      pressEnter(typeInput);
      for (let attempt = 0; attempt < 12 && !pick; attempt++) {
        await sleep(200);
        pick = findOption();
      }
      if (!pick) return false;
    }

    if (!pick) {
      if (typeInput && config && config.allowCreate) {
        pressEnter(typeInput);
        return true;
      }
      return false;
    }
    const chosen = optText(pick);
    pick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    pick.click();
    flash(control);
    await sleep(120);
    return selectionAgrees(control, chosen);
  }

  // After a click, whether the control now shows the option we meant to pick.
  // A control that shows nothing we can read counts as agreeing; one that shows
  // some other choice does not, so a misclick is reported rather than "filled".
  function selectionAgrees(control, chosen) {
    const field = control.closest('[data-automation-id^="formField"]');
    const shown = [customValue(control)];
    if (control.matches("button")) shown.push(control.textContent);
    if (field) queryAll('[data-automation-id="selectedItem"], button[aria-haspopup="listbox"]', field).forEach((n) => shown.push(n.textContent));
    const seen = shown.map(normalize).filter((t) => t && !/^select\b/.test(t));
    return !seen.length || seen.some((t) => t.includes(chosen) || chosen.includes(t));
  }

  // Lever-style place search: type the city, which searches on keydown, then
  // press the suggestion for the profile's state ("City, State, ..."). Returns
  // the picked suggestion's text, or "" when none matches.
  async function setLocationSearch(input, city, places) {
    const field = input.closest(".application-field") || input.parentElement;
    setSearchValue(input, city);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: city.slice(-1) }));
    const wanted = places.map(normalize);
    let pick = null;
    for (let attempt = 0; attempt < 20 && !pick; attempt++) {
      if (attempt) await sleep(250);
      pick = queryAll(".dropdown-location", field).find((o) => {
        const text = normalize(o.textContent);
        return wanted.some((place) => text === place || text.startsWith(place + ","));
      });
    }
    if (!pick) return "";
    const text = pick.textContent.trim();
    pick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    flash(input);
    return input.value.trim() === text ? text : "";
  }

  // The selection a custom dropdown shows, or "" when it has none.
  function customValue(control) {
    // Workday button-listboxes show their selection as the button text.
    if (control.matches("button")) {
      const text = control.textContent.trim();
      return /^select( one)?\.*$/i.test(text) ? "" : text;
    }
    const shown = control.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]');
    if (shown) return shown.textContent.trim();
    const input = control.matches("input") ? control : control.querySelector("input");
    return input ? input.value.trim() : "";
  }

  // Open a custom dropdown, read the option labels from the listbox its input
  // controls, and close it. Returns [] when it names no listbox of its own.
  async function customOptions(control) {
    if (control.matches("button")) return buttonOptions(control);
    const input = control.matches("input") ? control : control.querySelector("input");
    if (!input) return [];
    press(control);
    await sleep(250);
    const listbox = document.getElementById(input.getAttribute("aria-controls") || "");
    const labels = listbox ? queryAll('[role="option"]', listbox).map((o) => o.textContent.trim()).filter(Boolean) : [];
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
    // While the browser window is unfocused, blur() fires nothing and
    // react-select ignores Escape. React's onBlur listens to focusout.
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    input.blur();
    await sleep(100);
    return [...new Set(labels)];
  }

  function pressEnter(el) {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", keyCode: 13 }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", keyCode: 13 }));
  }

  // Workday button-listboxes have no inner input: the popup is a portal listbox,
  // named by aria-controls when the page sets it, else the visible one.
  async function buttonOptions(button) {
    press(button);
    await sleep(300);
    const shown = (o) => o.offsetParent !== null || o.getClientRects().length > 0;
    const named = document.getElementById(button.getAttribute("aria-controls") || "");
    const boxes = named ? [named] : queryAll('[role="listbox"]').filter(shown);
    const labels = boxes.flatMap((box) => queryAll('[role="option"], [data-automation-id="promptOption"]', box)).map((o) => (o.getAttribute("data-automation-label") || o.textContent).trim()).filter(Boolean);
    for (const target of [button, document.activeElement || button]) {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", keyCode: 27 }));
    }
    await sleep(100);
    return [...new Set(labels)];
  }

  function press(el) {
    const init = { bubbles: true, cancelable: true, composed: true, button: 0, view: window };
    const Pointer = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Pointer("pointerdown", { ...init, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
    el.dispatchEvent(new Pointer("pointerup", init));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
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
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
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
    queryAll,
    customValue,
    customOptions,
    setTextValue,
    setDateSpinner,
    setNativeSelect,
    setRadio,
    setCheckbox,
    setReactSelect,
    setLocationSearch,
    uploadToInput,
    dropOnZone,
    normalize,
    sleep,
  };
})();
