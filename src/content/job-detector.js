// Page evidence only. Never reads applicant input values or sends page text away.
(function () {
  const A = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});
  const M = A.trackerModel;
  const ATS = /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|taleo\.net|workable\.com|smartrecruiters\.com)$/i;
  const GENERIC = /^(?:careers?|jobs?|job details|job application|apply(?: now| for (?:this|a) (?:job|position))?|application(?: form| submitted)?|thank you.*|personal information|my information|my experience|review|sign in|log in|create an account|join (?:our|the) team)$/i;
  function visible(node) {
    if (!node || node.closest('script, style, template, noscript, pre, code, textarea, [contenteditable="true"], [hidden], [aria-hidden="true"], #avid-autofill-root, #avid-tracker-root')) return false;
    for (let p = node; p && p !== document.documentElement; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }
  function text(selector, limit = 300) {
    for (const node of document.querySelectorAll(selector)) {
      const value = M.clean(node.textContent, limit);
      if (value && visible(node)) return value;
    }
    return "";
  }
  function meta(name) {
    return M.clean(document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content, 1000);
  }
  function posting() {
    const jobs = [];
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 8) return;
      if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
      if ([].concat(value["@type"] || []).includes("JobPosting")) jobs.push(value);
      if (value["@graph"]) visit(value["@graph"], depth + 1);
      if (value.mainEntity) visit(value.mainEntity, depth + 1);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (script.textContent.length > 300000) continue;
      try { visit(JSON.parse(script.textContent)); } catch { /* Malformed publisher metadata is optional. */ }
    }
    return jobs.length === 1 ? jobs[0] : null;
  }
  function success() {
    // ponytail: English confirmation evidence only; add localized phrases with fixtures.
    const yes = /\b(?:your application (?:has been |was |is )?(?:successfully )?(?:submitted|received|sent)|(?:we(?:'ve| have)?|the (?:team|company)) (?:successfully )?received your application|application (?:has been |was )?(?:successfully )?(?:submitted|received)|thank(?:s| you) for (?:applying|submitting your (?:job )?application))\b/i;
    const no = /\b(?:if|when|once|until|after|will|not|never|unable|failed|unsuccessful|couldn't|cannot|can't)\b/i;
    for (const node of document.querySelectorAll('h1, h2, h3, p, [role="status"], [role="alert"], [data-automation-id*="uccess"], [class*="confirmation"], [class*="thank-you"], div, span')) {
      // Small leaf messages avoid matching a sentence buried inside a job description.
      if (node.children.length > 3 || node.textContent.length > 350) continue;
      const value = M.clean(node.textContent, 350);
      if (value.split(/[.!?\n]+/).some(sentence => yes.test(sentence) && !no.test(sentence)) && visible(node)) return true;
    }
    return false;
  }
  function inspect() {
    if (!/^https?:$/.test(location.protocol)) return null;
    const data = posting();
    const known = ATS.test(location.hostname);
    const heading = text('[data-automation-id="jobPostingHeader"], [data-automation-id="jobTitle"], [data-automation-id="jobTitleHeading"], .posting-headline h2, .job-title, [data-testid="job-title"], h1');
    const pageTitle = meta("og:title") || document.title;
    const hasCues = known || data || /\b(?:jobs?|careers?|apply|applying|applications?|positions?|vacanc(?:y|ies))\b/i.test(`${location.pathname.replaceAll("/", " ")} ${heading} ${pageTitle}`) || document.querySelector('input[type="file"], [role="status"], [role="alert"], [class*="confirmation"], [class*="thank-you"]');
    const confirmed = success();
    if (!hasCues && !confirmed) return { isJob: false, confirmed: false, job: { url: M.jobUrl(location.href) }, pageUrl: location.href, referrer: document.referrer };
    let role = M.clean(data?.title) || (!GENERIC.test(heading) ? heading : "");
    if (!role && known && !confirmed) {
      const title = pageTitle.replace(/^(?:Job application for|Apply for)\s+/i, "").split(/\s+[|–—]\s+|\s+at\s+/)[0];
      if (!GENERIC.test(title)) role = M.clean(title, 300);
    }
    let company = M.clean(data?.hiringOrganization?.name, 200) || text('[data-testid="company-name"], .company-name, [itemprop="hiringOrganization"]', 200);
    if (!company) {
      const home = document.querySelector('[data-automation-id="companyLogo"] img, a[data-automation-id="careerSiteLogo"] img, .company-logo img');
      company = M.clean(home?.alt, 200).replace(/\s+(?:logo|careers)$/i, "");
    }
    if (!company && role) {
      const match = pageTitle.match(/\s+at\s+(.+?)(?:\s+[|–—]\s+.*)?$/i);
      if (match) company = M.clean(match[1], 200);
    }
    const siteName = meta("og:site_name");
    if (!company && siteName && !/^(?:careers?|jobs?|greenhouse|lever|workday|ashby|icims)$/i.test(siteName)) company = M.clean(siteName, 200);
    const loc = [].concat(data?.jobLocation || [])[0]?.address;
    const place = typeof loc === "string" ? loc : [loc?.addressLocality, loc?.addressRegion, loc?.addressCountry].filter(v => typeof v === "string").join(", ");
    const jobLocation = M.clean(place, 200) || (data?.jobLocationType === "TELECOMMUTE" ? "Remote" : text('[data-automation-id="locations"], [data-automation-id="jobLocation"], .posting-categories .location, .job-location, [data-testid="job-location"]', 200));
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const resolve = value => { try { return typeof value === "string" ? new URL(value, location.href).href : ""; } catch { return ""; } };
    const meaningful = url => url && (/\/(?:jobs?|careers?|positions?|requisitions?|vacancies|opportunities)\//i.test(url) || /[?&](?:gh_jid|job_?id|jid|req_?id)=/i.test(url) || ATS.test(new URL(url).hostname));
    const url = M.jobUrl(resolve(data?.url)) || M.jobUrl(meaningful(canonical) ? canonical : location.href);
    const controls = [...document.querySelectorAll('button, input[type="submit"], a')].filter(visible);
    const apply = controls.some(n => /^(?:apply(?: now| for this (?:job|position))?|submit (?:my |your )?application|send application)$/i.test(M.clean(n.textContent || n.getAttribute("value"), 120)));
    const form = !!document.querySelector('input[type="email"], input[autocomplete="email"], input[type="file"], [data-automation-id="jobApplication"], #application_form');
    const jobPath = /\/(?:jobs?|careers?|positions?|requisitions?|vacancies|opportunities|apply)(?:\/|$)/i.test(location.pathname) || /[?&](?:gh_jid|job_?id|jid|req_?id)=/i.test(location.search);
    const jobWords = /\b(?:job|position|employment|career|resume|curriculum vitae)\b/i.test([heading, pageTitle, text('label[for*="resume"], label[for*="cv"]')].join(" "));
    const isJob = !!data || (!!role && apply && (known || jobPath || jobWords)) || (known && jobPath && form && !!role);
    const application = isJob && form;
    return {
      job: { company, role: GENERIC.test(role) ? "" : M.clean(role, 300), url, location: jobLocation },
      isJob, application, confirmed, confirmationContext: known || jobPath || jobWords,
      pageUrl: location.href, referrer: document.referrer,
    };
  }
  A.jobDetector = { inspect, success };
})();
