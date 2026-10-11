// Extra answer candidates for Jev, all built locally: bank questions ranked by
// similarity to a field, short lines from the saved work and education
// history, and fill-in templates completed from the job page and the profile.
// Jev still only chooses among these; nothing here writes new prose.
(function () {
  const A = globalThis.AvidAutofill = globalThis.AvidAutofill || {};
  const STOP = new Set("a an the of to for in on at by with and or is are was were be been do does did you your yours i me my we our us this that these those it its what which who how when where why will would can could should have has had if any please there their them they from as about than then so such".split(" "));
  // Words that mean the same thing on application forms, folded to one token.
  const SYNONYMS = {
    employer: "company", organization: "company", organisation: "company", firm: "company",
    wage: "salary", pay: "salary", compensation: "salary", remuneration: "salary", ctc: "salary",
    relocate: "relocation", move: "relocation", moving: "relocation",
    begin: "start", commence: "start", join: "start", available: "availability",
    visa: "sponsorship", sponsor: "sponsorship",
    hybrid: "remote", wfh: "remote", onsite: "office", "on-site": "office",
    travelling: "travel", traveling: "travel",
    degree: "education", university: "school", college: "school", major: "field",
    job: "role", position: "role", title: "role", opening: "role",
    resign: "notice",
    referral: "referred", heard: "referred", found: "referred", source: "referred",
    linkedin: "profile", github: "profile", portfolio: "profile",
  };
  function stem(word) {
    if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
    if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }
  function tokens(text) {
    const out = new Set();
    for (const raw of String(text).toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
      if (!raw || STOP.has(raw)) continue;
      const word = SYNONYMS[raw] || SYNONYMS[stem(raw)] || stem(raw);
      if (word.length > 1) out.add(word);
    }
    return out;
  }
  // Rare shared words count more than common ones across the entries compared.
  function weights(sets) {
    const counts = new Map();
    for (const set of sets) for (const word of set) counts.set(word, (counts.get(word) || 0) + 1);
    return word => Math.log(1 + (sets.length + 1) / (1 + (counts.get(word) || 0)));
  }
  // Similarity in [0, 1] between a field label and each entry's text, by
  // weighted token overlap (Dice-style).
  function scores(label, texts) {
    const asked = new Set();
    for (const part of String(label).split(" | ")) for (const word of tokens(part)) asked.add(word);
    const sets = texts.map(tokens), weight = weights([asked, ...sets]);
    const total = set => [...set].reduce((sum, word) => sum + weight(word), 0), base = total(asked);
    return sets.map(set => {
      const shared = [...set].filter(word => asked.has(word)).reduce((sum, word) => sum + weight(word), 0), other = total(set);
      return base && other ? 2 * shared / (base + other) : 0;
    });
  }
  const KEEP = 10;
  // The sources worth offering Jev for one field. Profile facts always stay.
  // Bank answers and templates are cut to the KEEP most similar, so a large
  // bank neither bloats the request nor distracts the model; small banks are
  // passed whole.
  function narrow(field, sources, keep = KEEP) {
    const ranked = Object.keys(sources).filter(id => /^(bank|template)_/.test(id));
    if (ranked.length <= keep) return sources;
    const score = scores(field.label, ranked.map(id => sources[id].description)), best = new Map(ranked.map((id, i) => [id, score[i]]));
    const kept = new Set(ranked.sort((a, b) => best.get(b) - best.get(a)).slice(0, keep));
    return Object.fromEntries(Object.entries(sources).filter(([id]) => !/^(bank|template)_/.test(id) || kept.has(id)));
  }
  const text = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const range = job => [text(job.startDate), job.current ? "present" : text(job.endDate)].filter(Boolean).join(" to ");
  function firstSentences(description, limit) {
    const sentences = text(description).match(/[^.!?]+[.!?]*/g) || [];
    let out = "";
    for (const sentence of sentences) { if ((out + sentence).length > limit) break; out += sentence; }
    return out.trim();
  }
  // Lines from the applicant's own saved history; nothing is rewritten.
  function historySources(profile) {
    const sources = {}, add = (id, description, value) => { if (value) sources[`history_${id}`] = { description, value, kind: "text" }; };
    const work = (Array.isArray(profile.work) ? profile.work : []).filter(job => job && (text(job.title) || text(job.company)));
    const education = (Array.isArray(profile.education) ? profile.education : []).filter(entry => entry && (text(entry.school) || text(entry.degree)));
    if (work.length) {
      add("title", "Most recent job title", text(work[0].title));
      add("company", "Most recent employer", text(work[0].company));
      add("summary", "Short summary of what the applicant does or did in their most recent role", firstSentences(work[0].description, 400));
      if (work.length > 1) add("roles", "Previous roles and employers", work.slice(0, 5).map(job => `${text(job.title)}${text(job.company) ? ` at ${text(job.company)}` : ""}${range(job) ? ` (${range(job)})` : ""}`).join("; "));
    }
    if (education.length) {
      const e = education[0];
      add("degree", "Highest or most recent degree and field of study", [text(e.degree), text(e.field)].filter(Boolean).join(" in "));
      add("school", "School or university attended", text(e.school));
    }
    return sources;
  }
  // Stock answers with blanks. A template is offered only when every blank has
  // a value, so a filled answer never contains a placeholder. The applicant can
  // add their own as profile.answerTemplates: { id, question, text }.
  const TEMPLATES = [
    { id: "why_company", question: "Why do you want to work at this company?", text: "I'm interested in the {role} role at {company}. My experience as {currentTitle} at {currentCompany} matches the work, and I'd like to bring it to {company}." },
    { id: "why_role", question: "Why are you interested in this role or position?", text: "The {role} role fits my background as {currentTitle} at {currentCompany}, and it is the kind of work I want to keep doing." },
    { id: "current_work", question: "Tell us about your current or most recent role", text: "I'm {currentTitle} at {currentCompany}.{summary}" },
    { id: "why_leaving", question: "Why are you looking for a new job or leaving your current role?", text: "I'm looking for a {role} role at a company like {company}, where I can build on my work as {currentTitle}." },
  ];
  const BLANK = /\{(\w+)\}/g;
  function cleanJob(job) {
    const one = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f{}<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : "";
    return job && typeof job === "object" ? { company: one(job.company), role: one(job.role) } : { company: "", role: "" };
  }
  function templateSources(profile, job) {
    const page = cleanJob(job), recent = (Array.isArray(profile.work) ? profile.work : [])[0] || {};
    const summary = firstSentences(recent.description, 300);
    const values = { company: page.company, role: page.role, currentTitle: text(recent.title), currentCompany: text(recent.company), firstName: text(profile.personal?.firstName), summary: summary ? ` ${summary}` : "" };
    const own = (Array.isArray(profile.answerTemplates) ? profile.answerTemplates : []).filter(t => t && /^[a-zA-Z0-9_-]{1,60}$/.test(t.id || "") && typeof t.question === "string" && typeof t.text === "string" && t.question.trim() && t.question.length <= 500 && t.text.trim() && t.text.length <= 4000);
    const sources = {};
    for (const template of [...TEMPLATES, ...own].slice(0, 20)) {
      const blanks = [...template.text.matchAll(BLANK)].map(match => match[1]);
      // `summary` is optional extra text; every other blank must have a value.
      if (blanks.some(name => name !== "summary" && !values[name])) continue;
      if (blanks.some(name => !Object.hasOwn(values, name))) continue;
      sources[`template_${template.id}`] = { description: template.question, value: template.text.replace(BLANK, (_, name) => values[name]).trim(), kind: "text" };
    }
    return sources;
  }
  A.candidates = { tokens, scores, narrow, historySources, templateSources, cleanJob, KEEP };
})();
