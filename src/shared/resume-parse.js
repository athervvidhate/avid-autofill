// Resume text -> profile fields, entirely on device. Plain script (no import/export)
// so it loads beside schema.js in extension pages and in tests.
//
// It is a set of layout heuristics, not a model: it reads the header for contact
// details, splits the body by section headings, then anchors job entries on date
// ranges and school entries on school/degree words. Anything it is unsure of is left
// blank; the review step lets the user correct what it did find.
(function () {
  const A = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  // One date: "Jun 2020", "June, 2020", "06/2020", "2020", or a word meaning now.
  const DATE_RE = `(?:${MONTH_RE}\\s*,?\\s*(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])\\s*[/.]\\s*(?:19|20)\\d{2}|(?:19|20)\\d{2}|present|current|now|ongoing|today)`;
  const RANGE = new RegExp(`(${DATE_RE})\\s*(?:-|–|—|to|until)\\s*(${DATE_RE})`, "i");
  const SINGLE = new RegExp(`(?:expected\\s+|exp\\.?\\s+|graduat\\w*\\s+)?(${DATE_RE})`, "i");
  const BULLET = /^\s*[•●○▪■◦‣∙·*▸►➢➤✓✔–—-]\s+/;

  const SECTIONS = [
    ["work", /^(?:(?:professional|work|relevant|industry|related|technical|research|teaching)\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career\s+history|internships?)$/i],
    ["education", /^(?:education(?:al)?(?:\s+(?:background|history|and\s+training))?|academic\s+(?:background|history)|academics)$/i],
    ["skills", /^(?:(?:technical|core|key|professional|relevant)\s+)?(?:skills?(?:\s*(?:&|and)\s*(?:interests|tools|technologies|languages|certifications?))?|competenc(?:ies|y)|technologies|tech\s+stack|tools(?:\s*(?:&|and)\s*technologies)?|areas\s+of\s+expertise|expertise)$/i],
    ["other", /^(?:summary|professional\s+summary|profile|objective|about(?:\s+me)?|projects?|(?:personal|side|selected|academic)\s+projects?|certifications?|licenses?(?:\s*(?:&|and)\s*certifications?)?|awards?(?:\s*(?:&|and)\s*honors?)?|honors?|achievements?|publications?|volunteer(?:ing)?(?:\s+experience)?|leadership|activities|extracurriculars?|interests|hobbies|references|languages|coursework|relevant\s+coursework|patents?|talks?|community)$/i],
  ];

  const TITLE_WORD = /\b(?:engineer(?:ing)?|developer|programmer|manager|intern(?:ship)?|analyst|designer|scientist|director|lead|consultant|specialist|associate|architect|assistant|coordinator|officer|president|founder|co-?founder|researcher|research|administrator|technician|representative|head|vp|vice|chief|ceo|cto|cfo|coo|principal|staff|senior|junior|sr\.?|jr\.?|fellow|tutor|instructor|professor|teacher|advisor|strategist|producer|editor|writer|accountant|auditor|recruiter|owner|partner|apprentice|volunteer|trainee|freelance[r]?|contractor|operator|supervisor|clerk|cashier|barista|server|sales|marketing|support|ta|swe|sde)\b/i;
  const DEGREE = /\b(?:bachelor(?:'?s)?|master(?:'?s)?|doctor(?:ate)?|associate(?:'?s)?|b\.?\s?(?:s|a|e|sc|tech|eng|fa|ba|comm)\.?(?=[\s,.\-–—(]|$)|m\.?\s?(?:s|a|e|sc|tech|eng|ba|fa|ed|phil)\.?(?=[\s,.\-–—(]|$)|mba|ph\.?\s?d\.?|j\.?d\.?|m\.?d\.?|diploma|certificate|a\.?a\.?s?\.?|high\s+school|ged)(?=$|[\s,.\-–—(:)])/i;
  const SCHOOL_WORD = /\b(?:university|college|institute(?:\s+of\s+technology)?|polytechnic|academy|school|universit[aéà]|universidad|conservatory|seminary|bootcamp)\b/i;
  const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
  const STATE_RE = US_STATES.join("|");
  const LOCATION = new RegExp(`\\b([A-Z][A-Za-z.'’ -]{1,28}),\\s*(${STATE_RE})\\b(?:\\s+(\\d{5})(?:-\\d{4})?)?|\\b(Remote|Hybrid)\\b`);

  const clean = s => (s || "").replace(/[  -​\t]+/g, " ").replace(/\s+/g, " ").trim();

  function normalizeDate(raw) {
    const s = clean(raw).replace(/[,.]/g, "");
    if (!s) return "";
    if (/^(present|current|now|ongoing|today)$/i.test(s)) return "Present";
    let m = s.match(new RegExp(`^(${MONTH_RE.replace("\\.?", "")})\\w*\\s*((?:19|20)\\d{2})$`, "i"));
    if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1, 3).toLowerCase()} ${m[2]}`;
    m = s.match(/^(0?[1-9]|1[0-2])\s*[/.]\s*((?:19|20)\d{2})$/);
    if (m) return `${MONTHS[+m[1] - 1][0].toUpperCase()}${MONTHS[+m[1] - 1].slice(1)} ${m[2]}`;
    return s;
  }
  // "Jun 2020 - Present" -> { startDate, endDate, current, text } with the dates cut out of text.
  function readDates(line) {
    const range = line.match(RANGE);
    if (range) {
      const end = normalizeDate(range[2]);
      return { startDate: normalizeDate(range[1]), endDate: end === "Present" ? "" : end, current: end === "Present", text: clean(line.replace(range[0], " ")), found: true };
    }
    return { startDate: "", endDate: "", current: false, text: line, found: false };
  }

  function headingOf(line) {
    const text = clean(line).replace(/[:|]+$/, "").replace(/^[#\s_=-]+|[_=\s-]+$/g, "");
    if (!text || text.length > 48 || /[.@]/.test(text.replace(/&/g, ""))) return null;
    for (const [name, re] of SECTIONS) if (re.test(text)) return name;
    return null;
  }

  function parseHeader(lines) {
    const out = { personal: {}, links: {} };
    const head = lines.slice(0, 14);
    const all = head.join("\n");
    const email = all.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (email) out.personal.email = email[0];
    const phone = all.match(/(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/);
    if (phone) out.personal.phone = clean(phone[0]);
    // The first 60 lines cover link rows that sit in a footer-style contact block.
    const flat = lines.slice(0, 60).join(" ");
    const grab = re => { const m = flat.match(re); return m ? `https://${m[0].replace(/^https?:\/\//i, "").replace(/[).,;|]+$/, "")}` : ""; };
    const linkedin = grab(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_%-]+/i);
    const shortIn = !linkedin && flat.match(/(?:^|[\s|•·])in\/([A-Za-z0-9_%-]+)/);
    const github = grab(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i);
    if (linkedin) out.links.linkedin = linkedin;
    else if (shortIn) out.links.linkedin = `https://linkedin.com/in/${shortIn[1]}`;
    if (github) out.links.github = github;
    const skipHost = /linkedin\.com|github\.com|gmail\.|yahoo\.|outlook\.|hotmail\.|icloud\./i;
    for (const m of all.matchAll(/(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|app|ai|design|tech|xyz)(?:\/[^\s|,;]*)?/gi)) {
      const hit = m[0];
      if (skipHost.test(hit) || (email && email[0].includes(hit))) continue;
      if (/@/.test(all.slice(Math.max(0, m.index - 1), m.index))) continue;
      out.links.portfolio = `https://${hit.replace(/^https?:\/\//i, "").replace(/[).,;|]+$/, "")}`;
      break;
    }
    const loc = head.map(l => l.match(LOCATION)).find(Boolean);
    if (loc && loc[2]) {
      out.personal.city = clean(loc[1]).replace(/^.*[|•·]\s*/, "");
      out.personal.state = loc[2];
      if (loc[3]) out.personal.postalCode = loc[3];
    }
    // The name is the first short, letters-only line above any section heading.
    for (const line of head) {
      const text = clean(line.replace(/[|•·,].*$/, ""));
      if (headingOf(text) || /[\d@:/]/.test(text)) continue;
      const words = text.split(" ");
      if (words.length < 2 || words.length > 4 || text.length > 40) continue;
      if (!words.every(w => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*$/.test(w))) continue;
      if (TITLE_WORD.test(text) && words.length > 2) continue;
      const display = text === text.toUpperCase() ? text.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : text;
      const parts = display.replace(/,?\s+(?:Jr|Sr|II|III|IV|PhD|MBA)\.?$/i, "").split(" ");
      out.personal.firstName = parts[0];
      out.personal.lastName = parts.slice(1).join(" ");
      out.personal.fullName = display;
      break;
    }
    return out;
  }

  const endsSentence = l => /[.!?]$/.test(l) && l.split(" ").length > 5;
  // A plausible company/title line: short, starts like a name, not the end of a wrapped bullet.
  const looksLikeHeader = l => l.length <= 70 && /^[A-Z0-9(]/.test(l) && !endsSentence(l) && !/[a-z]\.$/.test(l.replace(/\b(?:Inc|Corp|Ltd|Co|LLC|Jr|Sr)\.$/, ""));
  const stripBullet = l => l.replace(BULLET, "");
  const isBullet = l => BULLET.test(l);

  // Split "Senior Engineer | Acme Corp | Austin, TX" style text into title, company, location.
  function splitRole(texts) {
    let location = "";
    const pieces = [];
    for (const raw of texts) {
      let text = clean(raw);
      const loc = text.match(LOCATION);
      if (loc) { location = location || clean(loc[0]); text = clean(text.replace(loc[0], " ")); }
      for (const p of text.split(/\s+[|·•]\s+|\s+[-–—]\s+|\s+@\s+|\s+at\s+|\s{3,}|,\s+(?=[A-Z])/)) {
        const t = clean(p).replace(/^[-–—|,·•\s]+|[-–—|,·•\s]+$/g, "");
        if (t) pieces.push(t);
      }
    }
    let title = pieces.find((p) => TITLE_WORD.test(p) && p.length <= 70) || "";
    if (!title && pieces.length > 1) title = pieces[0];
    const company = pieces.find((p) => p !== title) || "";
    return { title, company, location };
  }

  function parseWork(lines) {
    const anchors = [];
    lines.forEach((line, i) => { if (!isBullet(line) && RANGE.test(line)) anchors.push(i); });
    const entries = [];
    for (let a = 0; a < anchors.length; a++) {
      const at = anchors[a], prevEnd = a ? anchors[a - 1] + 1 : 0;
      const dates = readDates(lines[at]);
      // Header lines sit above the date (company/title) or on it. Walk back over short non-bullet lines.
      const head = [];
      for (let j = at - 1; j >= prevEnd && head.length < 2; j--) {
        const l = lines[j];
        if (isBullet(l) || !looksLikeHeader(l) || RANGE.test(l)) break;
        // A short line directly after a bullet-less description paragraph is still plausible; stop once the
        // line before it looks like body text.
        head.unshift(l);
      }
      // Company line, date line, then the title on the line below: look one line down when the
      // header still lacks a title or a company.
      const next = lines[at + 1];
      let from = at + 1;
      const first = splitRole([...head, dates.text].filter(Boolean));
      if ((!first.title || !first.company) && head.length < 2 && next && !isBullet(next) && looksLikeHeader(next) && anchors[a + 1] !== at + 1) { head.push(next); from++; }
      const stop = a + 1 < anchors.length ? anchors[a + 1] : lines.length;
      // The tail of this block already belongs to the next entry's header lines.
      let end = stop;
      if (a + 1 < anchors.length) {
        let n = 0;
        while (end - 1 > from && n < 2) {
          const l = lines[end - 1];
          if (isBullet(l) || !looksLikeHeader(l)) break;
          end--; n++;
        }
      }
      const body = [];
      // Join wrapped lines back onto the bullet or sentence they continue.
      for (let j = from; j < end; j++) {
        const l = lines[j];
        if (!isBullet(l) && body.length && !/[.!?:]$/.test(body[body.length - 1])) body[body.length - 1] += ` ${l}`;
        else body.push(stripBullet(l));
      }
      const role = splitRole([...head, dates.text].filter(Boolean));
      if (!role.title && !role.company) continue;
      entries.push({
        title: role.title, company: role.company, location: role.location,
        startDate: dates.startDate, endDate: dates.endDate, current: dates.current,
        description: body.join("\n").slice(0, 1800),
      });
    }
    return entries;
  }

  function parseEducation(lines) {
    const entries = [];
    let cur = null;
    const flush = () => { if (cur && (cur.school || cur.degree)) entries.push(cur); cur = null; };
    const fresh = () => ({ school: "", degree: "", field: "", location: "", startDate: "", endDate: "", gpa: "" });
    for (const raw of lines) {
      let line = stripBullet(raw);
      const gpa = line.match(/\bGPA\s*[:\-]?\s*([0-4](?:\.\d{1,2})?)(?:\s*\/\s*4(?:\.0+)?)?/i);
      if (gpa && cur) { cur.gpa = gpa[1]; line = clean(line.replace(gpa[0], " ")); }
      else if (gpa) { cur = fresh(); cur.gpa = gpa[1]; line = clean(line.replace(gpa[0], " ")); }
      if (isBullet(raw) && cur && !SCHOOL_WORD.test(raw) && !DEGREE.test(raw)) continue;
      const hasSchool = SCHOOL_WORD.test(line), hasDegree = DEGREE.test(line);
      const dates = readDates(line);
      let text = dates.text;
      if (!dates.found) {
        const single = line.match(SINGLE);
        if (single && /(?:19|20)\d{2}/.test(single[1])) {
          text = clean(line.replace(single[0], " "));
          if (hasSchool || hasDegree || cur) { cur ||= fresh(); if (!cur.endDate) cur.endDate = normalizeDate(single[1]); }
        }
      }
      if (!hasSchool && !hasDegree) {
        if (cur && !cur.field && /^(?:major|field)/i.test(text)) cur.field = clean(text.replace(/^[^:]*:/, ""));
        if (cur && dates.found) { cur.startDate ||= dates.startDate; cur.endDate ||= dates.endDate || (dates.current ? "Present" : ""); }
        continue;
      }
      // A second school line, or a second degree line, begins another entry.
      if (cur && ((hasSchool && cur.school && !hasDegree) || (hasDegree && cur.degree && !hasSchool) || (hasSchool && hasDegree && (cur.school || cur.degree)))) flush();
      cur ||= fresh();
      if (dates.found) { cur.startDate = dates.startDate; cur.endDate = dates.endDate || (dates.current ? "Present" : cur.endDate); }
      const loc = text.match(LOCATION);
      if (loc) { cur.location ||= clean(loc[0]); text = clean(text.replace(loc[0], " ")); }
      // Split on commas, bars and dashes; classify each piece.
      for (const piece of text.split(/\s+[|·•–—-]\s+|\s*\|\s*|;\s*/).flatMap(p => (SCHOOL_WORD.test(p) ? [p] : p.split(/,\s+(?=[A-Z])/))).map(p => clean(p.replace(/^[-–—|,\s]+|[-–—|,\s]+$/g, ""))).filter(Boolean)) {
        if (SCHOOL_WORD.test(piece) && !cur.school) { cur.school = piece; continue; }
        const d = piece.match(DEGREE);
        if (d && !cur.degree) {
          const named = piece.match(/^(.*?\b(?:bachelor|master|associate|doctor)(?:'s)?\s+of\s+(?:science|arts|engineering|fine arts|business administration|technology|education|philosophy|applied science|laws|computer science))\b[\s,]*(?:in\s+)?(.*)$/i);
          const inField = named ? null : piece.match(/\b(?:in|of)\s+(.+)$/i);
          if (named) { cur.degree = clean(named[1]); cur.field = clean(named[2].replace(/\s*\(.*$/, "")); continue; }
          const deg = clean(piece.replace(/\b(?:in|of)\s+.+$/i, ""));
          cur.degree = deg || d[0];
          if (inField) cur.field = clean(inField[1].replace(/\s*\(.*$/, ""));
          else { const tail = clean(piece.replace(d[0], "").replace(/^[,.\s-]+/, "")); if (tail && !cur.field && tail.length > 2) { cur.field = tail; cur.degree = clean(d[0]); } }
          continue;
        }
        if (!cur.field && cur.degree && !SCHOOL_WORD.test(piece) && piece.length <= 60) cur.field = piece;
        else if (!cur.school && piece.length <= 80 && !cur.degree) cur.school = piece;
      }
    }
    flush();
    return entries.map(e => ({ ...e, degree: e.degree.replace(/\s*,$/, ""), field: e.field.replace(/^(?:in|of)\s+/i, "") }));
  }

  function parseSkills(lines) {
    const seen = new Set(), out = [];
    for (const raw of lines) {
      let line = stripBullet(raw);
      const colon = line.indexOf(":");
      if (colon > 0 && colon <= 32) line = line.slice(colon + 1);
      for (const part of line.split(/[,;|•·●▪]|\s{2,}|\s\/\s/)) {
        const s = clean(part).replace(/^[-–—\s]+|[.\s]+$/g, "");
        if (!s || s.length > 40 || s.split(" ").length > 4) continue;
        const key = s.toLowerCase();
        if (!seen.has(key)) { seen.add(key); out.push(s); }
      }
    }
    return out.slice(0, 80);
  }

  A.parseResumeText = function parseResumeText(text) {
    const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
    const sections = { header: [], work: [], education: [], skills: [], other: [] };
    let current = "header";
    for (const line of lines) {
      const h = headingOf(line);
      if (h) { current = h; continue; }
      sections[current].push(line);
    }
    const headerPart = parseHeader([...sections.header, ...(sections.header.length ? [] : lines)]);
    return {
      personal: headerPart.personal,
      links: headerPart.links,
      work: parseWork(sections.work),
      education: parseEducation(sections.education),
      skills: parseSkills(sections.skills),
    };
  };

  // Which resume entries are already in the profile, so a second import does not duplicate them.
  const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  A.sameWork = (a, b) => norm(a.company) === norm(b.company) && norm(a.title) === norm(b.title);
  A.sameSchool = (a, b) => norm(a.school) === norm(b.school) && norm(a.degree) === norm(b.degree);
})();
