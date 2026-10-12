// Work history and education written as repeating rows (one row per job or school,
// with an "Add another" button). Each visible row gets its own profile entry in
// order, entries already on the form are left alone, and missing ones get a new
// row. Without this, every "Employer" box on the page took the first job.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  if (AvidAutofill.repeaters) return;

  const F = () => AvidAutofill.fillers;
  const label = (el) => {
    const own = (AvidAutofill.labelTextFor && AvidAutofill.labelTextFor(el)) || "";
    return String(own || el.getAttribute("aria-label") || el.placeholder || el.name || "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  };

  const KINDS = {
    work: {
      anchor: /\b(employer|company|organi[sz]ation)\b/,
      notAnchor: /why|reason|previous employer\?|agreement|size|website|phone/,
      entries: (p) => p.work || [],
      key: (e) => e.company,
      fields: [
        { re: /\b(employer|company|organi[sz]ation)( name)?\b/, get: (e) => e.company },
        { re: /\b(title|position|role)\b/, not: /\?|responsibilit|current position\b(?! title)/, get: (e) => e.title },
        { re: /\b(currently|current|present|still) (work|employ|position|job|role)|i (currently )?work here|current position\?|^current\b/, yesno: true, get: (e) => !!e.current },
        { re: /\b(start|from|begin)/, date: "start", get: (e) => e.startDate },
        { re: /\b(end|to|until|through)\b/, date: "end", get: (e) => (e.current ? "" : e.endDate) },
        { re: /descri|responsibilit|duties|summary|accomplish|achievement/, get: (e) => e.description },
        { re: /\b(location|city)\b/, get: (e) => e.location },
        { re: /\bcountry\b/, get: (e, p) => p.personal.country },
      ],
    },
    education: {
      anchor: /\b(school|university|college|institution)\b/,
      notAnchor: /high school diploma\?|are you|enrolled|graduation/,
      entries: (p) => p.education || [],
      key: (e) => e.school,
      fields: [
        { re: /\b(school|university|college|institution)( name)?\b/, get: (e) => e.school },
        { re: /\b(degree|diploma|qualification)\b/, degree: true, get: (e) => e.degree },
        { re: /\b(major|field|discipline|concentration|area of study|subject)\b/, get: (e) => e.field },
        { re: /\b(gpa|grade point)\b/, get: (e) => e.gpa },
        { re: /still attending|currently (attending|enrolled)/, yesno: true, get: (e) => stillAttending(e) },
        { re: /\b(start|from|begin)/, date: "start", get: (e) => e.startDate },
        { re: /\b(end|to|until|graduat|completion|completed)\b/, date: "end", get: (e) => e.endDate },
        { re: /\b(location|city)\b/, get: (e) => e.location },
        { re: /\bcountry\b/, get: (e, p) => p.personal.country },
      ],
    },
  };

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // "Jun 2025", "06/2025", "2025-06", "2025" -> { y: 2025, m: 6 }; "Present" -> null.
  function parseDate(text) {
    const t = String(text || "").trim().toLowerCase();
    const year = t.match(/\b(19|20)\d{2}\b/);
    if (!year) return null;
    let m = MONTHS.findIndex((name) => t.includes(name)) + 1;
    if (!m) {
      const num = t.match(/^(\d{1,2})[/-](?:19|20)\d{2}$/) || t.match(/^(?:19|20)\d{2}-(\d{1,2})/);
      m = num ? Number(num[1]) : 0;
    }
    return { y: Number(year[0]), m: m >= 1 && m <= 12 ? m : 0 };
  }

  function stillAttending(e) {
    const d = parseDate(e.endDate);
    if (/present|current/i.test(e.endDate || "")) return true;
    if (!d) return false;
    const now = new Date();
    return d.y > now.getFullYear() || (d.y === now.getFullYear() && (d.m || 12) > now.getMonth() + 1);
  }

  // Degree names as option lists spell them: "BS" -> Bachelor's Degree.
  function degreeAlts(degree) {
    const d = String(degree || "").toLowerCase().replace(/\./g, "");
    if (/\b(phd|doctor|doctorate|dphil)\b/.test(d)) return ["Doctorate", "Doctoral Degree", "PhD", "Doctor"];
    if (/\b(jd|juris)\b/.test(d)) return ["Juris Doctor Degree", "Juris Doctor", "JD"];
    if (/\b(md)\b/.test(d)) return ["Doctor of Medicine", "MD"];
    if (/\b(mba)\b/.test(d)) return ["MBA", "Master's Degree", "Masters"];
    if (/\b(ms|ma|msc|meng|master|masters)\b/.test(d)) return ["Master's Degree", "Masters", "Master's", "Master"];
    if (/\b(bs|ba|bsc|beng|bachelor|bachelors)\b/.test(d)) return ["Bachelor's Degree", "Bachelors", "Bachelor's", "Bachelor"];
    if (/\b(as|aa|associate)\b/.test(d)) return ["Associate's Degree", "Associates", "Associate's", "Associate"];
    if (/high school|ged|diploma/.test(d)) return ["High School Graduate or Equivalent", "High School Diploma", "High School", "GED"];
    return [];
  }

  // A date written the way the box expects it.
  function dateValue(el, raw, lab) {
    const d = parseDate(raw);
    if (!d) return "";
    const mm = String(d.m || 1).padStart(2, "0");
    if (el.tagName === "SELECT") {
      if (/\byear\b/.test(lab)) return [String(d.y)];
      if (/\bmonth\b/.test(lab) && d.m) return [MONTH_NAMES[d.m - 1], MONTH_NAMES[d.m - 1].slice(0, 3), mm, String(d.m)];
      return [`${MONTH_NAMES[(d.m || 1) - 1]} ${d.y}`, String(d.y)];
    }
    const type = (el.type || "").toLowerCase();
    if (type === "month") return `${d.y}-${mm}`;
    if (type === "date") return `${d.y}-${mm}-01`;
    if (/\byear\b/.test(lab) && !/month/.test(lab)) return String(d.y);
    if (/\bmonth\b/.test(lab) && !/year/.test(lab)) return mm;
    const hint = String(el.placeholder || "").toLowerCase();
    if (/yyyy-mm/.test(hint)) return `${d.y}-${mm}`;
    if (/mm\/dd\/yyyy/.test(hint)) return `${mm}/01/${d.y}`;
    return `${mm}/${d.y}`;
  }

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameName = (a, b) => {
    const x = norm(a), y = norm(b);
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
  };

  const FIELD_SEL = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), select, textarea";
  const hiddenRow = (row) => !!row.closest('[aria-hidden="true"], [hidden]') || !row.querySelector(FIELD_SEL) ||
    !F().queryAll(FIELD_SEL, row).some((el) => F().isRendered(el));

  // A row holds the anchor and at least one more of its section's boxes (a title,
  // a date, a degree), so a lone "Company" question is not mistaken for one.
  function looksLikeRow(row, kind) {
    const hits = new Set();
    for (const el of F().queryAll("input, select, textarea", row)) {
      const l = label(el).replace(/\*/g, "").trim();
      if (l.length > 40) continue;
      const i = kind.fields.findIndex((r) => r.re.test(l) && !(r.not && r.not.test(l)));
      if (i >= 0) hits.add(i);
    }
    return hits.size >= 2;
  }

  // The rows of each repeating section: climb from every anchor box (Employer,
  // School) to the largest element holding no other anchor of its kind.
  function findGroups(kindName) {
    const kind = KINDS[kindName];
    const anchors = F().queryAll("input, textarea, select").filter((el) => {
      if (el.closest("#avid-autofill-root, #avid-tracker-root")) return false;
      const type = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "file", "checkbox", "radio", "password"].includes(type)) return false;
      // A short box label, not a question that happens to say "company".
      const l = label(el).replace(/\*/g, "").trim();
      return l.length <= 40 && kind.anchor.test(l) && !kind.notAnchor.test(l);
    });
    const rows = new Map(); // row element -> anchor
    for (const a of anchors) {
      let node = a;
      while (node.parentElement && node.parentElement !== document.body) {
        const parent = node.parentElement;
        if (anchors.some((o) => o !== a && parent.contains(o) && !node.contains(o))) break;
        node = parent;
      }
      if (!rows.has(node) && looksLikeRow(node, kind)) rows.set(node, a);
    }
    // Rows that are siblings form one section.
    const byParent = new Map();
    for (const [row, anchor] of rows) {
      const p = row.parentElement;
      if (!p) continue;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push({ row, anchor });
    }
    return [...byParent.entries()].map(([parent, list]) => ({ kind: kindName, parent, rows: list }));
  }

  const ADD = /^\+?\s*add\b(?!ress)|\badd (another|more|new|an?other)\b/i;
  const NOT_ADD = /cart|calendar|address|cover letter|attachment|file|document|link|website|photo/i;
  function addButtons() {
    return F().queryAll('button, a, [role="button"], input[type="button"]').filter((b) => {
      if (b.closest("#avid-autofill-root")) return false;
      const t = String(b.textContent || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      return t.length <= 40 && ADD.test(t) && !NOT_ADD.test(t) && F().isRendered(b);
    });
  }

  // How deep the closest shared ancestor of two nodes is; deeper means nearer.
  function sharedDepth(a, b) {
    const chain = new Set();
    for (let n = a; n; n = n.parentElement) chain.add(n);
    let n = b;
    while (n && !chain.has(n)) n = n.parentElement;
    let depth = 0;
    for (; n; n = n.parentElement) depth++;
    return depth;
  }

  // Each Add button belongs to the section it sits nearest to.
  function assignButtons(groups) {
    const buttons = addButtons();
    for (const g of groups) g.add = null;
    for (const b of buttons) {
      let best = null, bestDepth = -1;
      for (const g of groups) {
        const d = sharedDepth(b, g.parent);
        if (d > bestDepth) { best = g; bestDepth = d; }
      }
      // The button must sit beside the rows, not merely somewhere on the same form.
      if (best && bestDepth >= depthOf(best.parent) - 2 && !best.add) best.add = b;
    }
  }
  function depthOf(n) { let d = 0; for (; n; n = n.parentElement) d++; return d; }

  // A section is a repeater when it has two or more rows (a hidden template row
  // counts) or an Add button of its own.
  function repeaters() {
    const groups = [...findGroups("work"), ...findGroups("education")];
    assignButtons(groups);
    // A lone row needs a button that names its section ("Add experience"), since a
    // bare "Add another" there may belong to some other list on the form.
    const NAMES = { work: /experience|employment|job|position|employer|work/i, education: /education|school|degree|university/i };
    return groups.filter((g) => g.rows.length >= 2 || (g.add && NAMES[g.kind].test(g.add.textContent || g.add.value || "")));
  }

  function anchorValue(anchor) {
    if (anchor.tagName === "SELECT") return anchor.selectedIndex > 0 ? anchor.options[anchor.selectedIndex].textContent : "";
    return anchor.value || "";
  }

  function radioGroups(row) {
    const groups = new Map();
    for (const r of row.querySelectorAll('input[type="radio"]')) {
      if (!r.name) continue;
      if (!groups.has(r.name)) groups.set(r.name, []);
      groups.get(r.name).push(r);
    }
    return [...groups.values()];
  }

  // Fill one row's boxes from one profile entry. Returns how many boxes were set.
  function fillRow(row, kindName, entry, ctx, n) {
    const kind = KINDS[kindName];
    const fillers = F();
    let count = 0;
    const tag = `${kindName === "work" ? "Job" : "School"} ${n}`;
    const setOne = (el, rule, lab) => {
      let value = rule.get(entry, ctx.profile);
      if (rule.yesno) value = value ? "Yes" : "No";
      if (value == null || value === "") return;
      if (rule.date) value = dateValue(el, value, lab);
      if (!value || (Array.isArray(value) && !value.length)) return;
      const type = (el.type || "").toLowerCase();
      if (type === "checkbox") {
        if (!rule.yesno) return;
        if (fillers.setCheckbox(el, value === "Yes")) count++;
        ctx.record(`${tag}: ${lab}`, value, "filled");
        return;
      }
      if (el.tagName === "SELECT") {
        const alts = rule.degree ? [value, ...degreeAlts(value)] : Array.isArray(value) ? value : [value];
        const ok = fillers.setNativeSelect(el, alts);
        if (ok) count++;
        ctx.record(`${tag}: ${lab}`, Array.isArray(value) ? value[0] : value, ok ? "filled" : "no-option-match");
        return;
      }
      fillers.setTextValue(el, String(value));
      if (el.value) count++;
      ctx.record(`${tag}: ${lab}`, String(value), el.value ? "filled" : "skipped");
    };

    const rendered = (el) => fillers.isRendered(el) && !el.disabled;
    for (const el of fillers.queryAll(FIELD_SEL, row)) {
      ctx.handled.add(el);
      if (ctx.tried.has(el)) continue;
      const type = (el.type || "").toLowerCase();
      if (type === "radio" || !rendered(el)) continue;
      const lab = label(el);
      const rule = kind.fields.find((r) => r.re.test(lab) && !(r.not && r.not.test(lab)));
      if (!rule) continue;
      const hasValue = el.tagName === "SELECT" ? el.selectedIndex > 0 && !!el.value : type === "checkbox" ? false : !!el.value;
      if (hasValue && !ctx.settings.overwriteFilled) continue;
      ctx.tried.add(el);
      try { setOne(el, rule, lab); } catch (_) { ctx.record(`${tag}: ${lab}`, "", "error"); }
    }
    for (const group of radioGroups(row)) {
      group.forEach((r) => ctx.handled.add(r));
      const lab = AvidAutofill.matcher ? AvidAutofill.matcher.groupSignal(group).toLowerCase() : "";
      const rule = kind.fields.find((r) => r.yesno && r.re.test(lab));
      if (!rule || group.some((r) => r.checked)) continue;
      const value = rule.get(entry, ctx.profile) ? "Yes" : "No";
      const ok = fillers.setRadio(group.filter(rendered), value);
      if (ok) count++;
      ctx.record(`${tag}: ${lab}`, value, ok ? "filled" : "skipped");
    }
    return count;
  }

  async function waitForNewRow(group, before) {
    for (let i = 0; i < 30; i++) {
      await F().sleep(100);
      const fresh = repeaters().find((g) => g.kind === group.kind && (g.parent === group.parent || g.rows.some((r) => group.parent.contains(r.row))));
      const row = fresh && fresh.rows.find((r) => !before.has(r.row) && !hiddenRow(r.row));
      if (row) return { group: fresh, row };
    }
    return null;
  }

  // Fills every repeating section on the page. Rows it handles are added to
  // ctx.handled and returned, so the engine's page-wide passes leave them alone.
  async function fill(profile, outer) {
    const ctx = { ...outer, profile, tried: new WeakSet() };
    // Second looks at a row only fill boxes that appeared after the first.
    const later = { ...ctx, settings: { ...ctx.settings, overwriteFilled: false } };
    const roots = [];
    const groups = repeaters();
    const MAX_ADDED = 8;
    for (let group of groups) {
      const kind = KINDS[group.kind];
      const entries = kind.entries(profile).filter((e) => kind.key(e));
      roots.push(group.parent);
      if (group.add) roots.push(group.add);
      // Mark every box in the section, template rows included, as the section's own.
      for (const { row } of group.rows) F().queryAll("input, select, textarea, [role=combobox]", row).forEach((el) => ctx.handled.add(el));
      if (!entries.length) continue;

      const visible = group.rows.filter((r) => !hiddenRow(r.row));
      // Entries already on the form, by company or school name.
      const present = new Set();
      for (const r of visible) {
        const v = anchorValue(r.anchor);
        const i = entries.findIndex((e, idx) => !present.has(idx) && sameName(kind.key(e), v));
        if (i >= 0) present.add(i);
      }
      const todo = entries.map((e, i) => ({ e, i })).filter(({ i }) => !present.has(i));
      const empty = visible.filter((r) => !anchorValue(r.anchor));
      let n = 0;
      for (const r of empty) {
        const next = todo.shift();
        if (!next) break;
        fillRow(r.row, group.kind, next.e, ctx, next.i + 1);
        n++;
      }
      // Rows whose "end date" or similar appears only after "current" is answered.
      await F().sleep(250);
      for (const r of empty.slice(0, n)) {
        const entry = entries.find((e) => sameName(kind.key(e), anchorValue(r.anchor)));
        if (entry) fillRow(r.row, group.kind, entry, later, entries.indexOf(entry) + 1);
      }

      // Missing entries get a new row each.
      let added = 0;
      while (todo.length && group.add && added < MAX_ADDED) {
        const before = new Set(group.rows.map((r) => r.row));
        group.add.click();
        const made = await waitForNewRow(group, before);
        if (!made) break;
        group = { ...made.group, add: made.group.add || group.add };
        const next = todo.shift();
        F().queryAll("input, select, textarea, [role=combobox]", made.row.row).forEach((el) => ctx.handled.add(el));
        fillRow(made.row.row, group.kind, next.e, ctx, next.i + 1);
        await F().sleep(250);
        fillRow(made.row.row, group.kind, next.e, later, next.i + 1);
        added++;
      }
      if (todo.length) {
        ctx.record(`${group.kind === "work" ? "Work history" : "Education"}: ${todo.length} more to add`, todo.map(({ e }) => kind.key(e)).join(", "), "skipped");
      }
    }
    return roots;
  }

  AvidAutofill.repeaters = { fill, degreeAlts, _repeaters: repeaters, _parseDate: parseDate };
})();
