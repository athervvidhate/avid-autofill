// Review step for a parsed resume. Shows what was read next to what the profile already
// holds, lets the user edit or untick each piece, and only then merges the picks.
// Plain script; loads after schema.js, resume-parse.js and (in pages) resume-extract.ts.
(function () {
  const A = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const PERSONAL = [["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"], ["city", "City"], ["state", "State/Province"], ["postalCode", "Zip/Postal"]];
  const LINKS = [["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "Portfolio"]];
  const WORK = [["title", "Title"], ["company", "Company"], ["location", "Location"], ["startDate", "Start"], ["endDate", "End"], ["description", "Description", "wide"]];
  const EDU = [["school", "School"], ["degree", "Degree"], ["field", "Field of study"], ["startDate", "Start"], ["endDate", "End / expected"], ["gpa", "GPA"]];

  const monthIndex = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function recency(item) {
    if (item.current) return Infinity;
    const m = /(?:([A-Za-z]{3})\w*\s+)?((?:19|20)\d{2})/.exec(item.endDate || item.startDate || "");
    return m ? +m[2] * 12 + (monthIndex[(m[1] || "").toLowerCase()] ?? 0) : -1;
  }
  const skillList = text => String(text || "").split(",").map(s => s.trim()).filter(Boolean);

  function el(tag, props = {}, ...kids) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  }
  function field(id, label, value, wide, area) {
    const input = el(area ? "textarea" : "input", { id, value: value || "" });
    if (area) input.rows = 3;
    return el("div", { className: "field" + (wide ? " wide" : "") }, el("label", { className: "lbl", htmlFor: id }, label), input);
  }

  // Resolves to a new profile (the original is not mutated), or null if cancelled.
  A.reviewResumeImport = function reviewResumeImport(parsed, profile) {
    return new Promise(resolve => {
      let n = 0;
      const uid = () => `rv-${++n}`;
      const overlay = el("div", { className: "rv-overlay" });
      const dialog = el("div", { className: "rv-dialog", role: "dialog" });
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "rv-title");
      overlay.append(dialog);
      const body = el("div", { className: "rv-body" });
      const picks = []; // { box, apply(profile) }

      const group = (title, hint) => { const g = el("section", { className: "rv-group" }, el("h3", {}, title)); if (hint) g.append(el("p", { className: "rv-hint" }, hint)); body.append(g); return g; };

      // Contact and links: one row per value, ticked when it fills an empty field.
      const flatGroup = (title, section, spec) => {
        const rows = spec.filter(([key]) => (parsed[section] || {})[key]);
        if (!rows.length) return;
        const g = group(title);
        for (const [key, label] of rows) {
          const mine = parsed[section][key], saved = (profile[section] || {})[key] || "";
          const same = saved.trim().toLowerCase() === mine.toLowerCase();
          const id = uid();
          const box = el("input", { type: "checkbox", id: `${id}-on`, checked: !saved, disabled: same });
          const fld = field(`${id}-v`, label, mine), input = fld.querySelector("input");
          const wrap = el("div", { className: "rv-row" }, box, fld);
          if (saved && !same) wrap.append(el("small", { className: "rv-existing" }, `Replaces: ${saved}`));
          if (same) wrap.append(el("small", { className: "rv-existing" }, "Already saved"));
          g.append(wrap);
          picks.push({ box, apply: p => { const v = input.value.trim(); if (v) (p[section] ||= {})[key] = v; if (section === "personal" && (key === "firstName" || key === "lastName")) { const q = p.personal; q.fullName = [q.firstName, q.lastName].filter(Boolean).join(" ") || q.fullName; } } });
        }
      };

      const listGroup = (title, section, spec, same, label) => {
        if (!parsed[section].length) return;
        const g = group(title, "Ticked entries are added to your profile. Ones you already have are left alone.");
        parsed[section].forEach(item => {
          const dupe = (profile[section] || []).some(saved => same(saved, item));
          const id = uid();
          const card = el("div", { className: "card rv-card" });
          const box = el("input", { type: "checkbox", id: `${id}-on`, checked: !dupe });
          card.append(el("label", { className: "rv-add", htmlFor: `${id}-on` }, box, el("span", {}, `${label(item) || "Untitled"}${dupe ? " (already saved)" : ""}`)));
          const grid = el("div", { className: "grid" });
          for (const [key, text, wide] of spec) grid.append(field(`${id}-${key}`, text, item[key], wide === "wide", wide === "wide"));
          card.append(grid);
          g.append(card);
          picks.push({ box, apply: p => {
            const entry = Object.fromEntries(spec.map(([key]) => [key, card.querySelector(`#${id}-${key}`).value.trim()]));
            if (item.current) { entry.current = true; entry.endDate = ""; }
            (p[section] ||= []).push(entry);
            p[section].sort((a, b) => recency(b) - recency(a));
          } });
        });
      };

      flatGroup("Contact", "personal", PERSONAL);
      flatGroup("Links", "links", LINKS);
      listGroup("Work history", "work", WORK, A.sameWork, w => [w.title, w.company].filter(Boolean).join(" at "));
      listGroup("Education", "education", EDU, A.sameSchool, e => [e.degree, e.school].filter(Boolean).join(", "));
      const have = new Set(skillList(profile.misc?.skills).map(s => s.toLowerCase()));
      const fresh = parsed.skills.filter(s => !have.has(s.toLowerCase()));
      if (fresh.length) {
        const g = group("Skills", "Added to your existing skills list.");
        const id = uid();
        const box = el("input", { type: "checkbox", id: `${id}-on`, checked: true });
        const area = field(`${id}-v`, "Skills (comma-separated)", fresh.join(", "), true, true);
        g.append(el("div", { className: "rv-row" }, box, area));
        picks.push({ box, apply: p => {
          const merged = skillList(p.misc?.skills), seen = new Set(merged.map(s => s.toLowerCase()));
          for (const s of skillList(area.querySelector("textarea").value)) if (!seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); merged.push(s); }
          (p.misc ||= {}).skills = merged.join(", ");
        } });
      }
      if (!picks.length) body.append(el("p", { className: "rv-empty" }, "Nothing new was found in this resume."));

      const close = result => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(result); };
      const onKey = e => { if (e.key === "Escape") close(null); };
      const apply = el("button", { className: "btn primary", type: "button", id: "rv-apply" }, "Add to my profile");
      const cancel = el("button", { className: "btn secondary", type: "button", id: "rv-cancel" }, "Cancel");
      apply.disabled = !picks.length;
      apply.onclick = () => {
        const next = JSON.parse(JSON.stringify(profile));
        for (const pick of picks) if (pick.box.checked && !pick.box.disabled) pick.apply(next);
        next.meta = { ...(next.meta || {}), importedAt: new Date().toISOString(), source: "resume" };
        close(next);
      };
      cancel.onclick = () => close(null);
      document.addEventListener("keydown", onKey);
      dialog.append(
        el("h2", { id: "rv-title" }, "Review what Avid read"),
        el("p", { className: "rv-hint" }, "Read on this device from your resume. Nothing was uploaded. Edit anything that looks off, and untick what you do not want. Existing values are only replaced when you tick them."),
        body,
        el("div", { className: "rv-actions" }, cancel, apply),
      );
      document.body.append(overlay);
      (picks.length ? apply : cancel).focus();
    });
  };

  // File -> text -> parsed -> review. Resolves to the merged profile, or null if the user cancelled.
  // Throws a readable Error when the file cannot be read.
  A.importResume = async function importResume(file, profile) {
    if (!A.extractResumeText) throw new Error("Resume reading is not available on this page.");
    const parsed = A.parseResumeText(await A.extractResumeText(file));
    if (!parsed.personal.email && !parsed.work.length && !parsed.education.length && !parsed.skills.length) throw new Error("Avid could not find a resume's contents in that file.");
    return A.reviewResumeImport(parsed, profile);
  };
})();
