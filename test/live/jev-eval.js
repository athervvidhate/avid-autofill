// Live Jev evaluation. Open from the unpacked extension after saving a key in
// My Info, with the collector running (node test/live/collect.mjs <dir>):
//   chrome-extension://<id>/test/live/jev-eval.html?set=smoke
// `set` takes comma-separated set names or case IDs. The page runs the
// production pipeline (sourcesFor, cleanFields, match, post) on synthetic
// cases, grades every field, and posts the report to the collector. The key is
// read in this trusted page and sent only to Jev.
(function () {
  const J = globalThis.AvidAutofill.jev;
  const USD_PER_INPUT_TOKEN = 0.042 / 1e6; // docs.typesafe.ai/models, checked 2026-10-08; output is free

  function grade(field, result) {
    const filled = result.status === "fill";
    if (field.expect === null) return filled ? "wrong-fill" : "correct-abstain";
    if (!filled) return "missed";
    const right = typeof field.expect === "object" && !Array.isArray(field.expect)
      ? result.optionId === field.expect.option
      : [].concat(field.expect).includes(result.sourceId);
    return right ? "correct" : "wrong-fill";
  }

  // Winning choice, its probability and confidence, and the runner-up.
  function trace(answer) {
    const [best, next] = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    return { choice: answer.choice, p: best[1], confidence: answer.confidence, next: next?.[0], pNext: next?.[1] };
  }

  async function runCase(c, key) {
    const sources = J.sourcesFor(globalThis.JEV_PROFILE, c.pageUrl), fields = J.cleanFields(c.fields), stages = [{}, {}];
    const usage = { input_tokens: 0, output_tokens: 0, calls: 0 };
    let call = 0;
    const post = async (request, stage) => {
      const reply = await J.post(request, key);
      usage.input_tokens += reply.usage.input_tokens; usage.output_tokens += reply.usage.output_tokens; usage.calls++;
      for (const [question, answer] of Object.entries(reply.answers)) stages[stage][question.replace(/^answer_/, "")] = trace(answer);
      return reply;
    };
    const started = performance.now();
    try {
      const { results } = await J.match(fields, sources, request => post(request, call++));
      const ms = Math.round(performance.now() - started);
      // Calibration probe: map options for choice fields that stage one picked
      // but the production threshold stopped. Does not affect grading.
      const probe = fields.filter(f => f.options && !stages[1][f.id] && stages[0][f.id].choice !== "NEEDS_USER");
      if (probe.length) await post(J.requestFor(probe, sources, Object.fromEntries(probe.map(f => [f.id, stages[0][f.id].choice]))), 1);
      return {
        id: c.id, ms, usage,
        fields: c.fields.map((field, i) => ({
          id: field.id, type: field.type, tag: field.tag, label: field.label, expect: field.expect, outcome: grade(field, results[i]),
          status: results[i].status, sourceId: results[i].sourceId, optionId: results[i].optionId,
          stage1: stages[0][field.id], stage2: stages[1][field.id], probed: probe.some(f => f.id === field.id),
        })),
      };
    } catch (error) {
      return { id: c.id, ms: Math.round(performance.now() - started), usage, error: error.message };
    }
  }

  function summarize(report) {
    const fields = report.cases.flatMap(c => c.fields || []), outcomes = {}, byTag = {};
    for (const f of fields) {
      outcomes[f.outcome] = (outcomes[f.outcome] || 0) + 1;
      (byTag[f.tag] ||= {})[f.outcome] = (byTag[f.tag][f.outcome] || 0) + 1;
    }
    const used = report.cases.map(c => c.usage);
    const inputTokens = used.reduce((n, u) => n + u.input_tokens, 0);
    return {
      fields: fields.length, outcomes, byTag, errors: report.cases.filter(c => c.error).map(c => `${c.id}: ${c.error}`),
      calls: used.reduce((n, u) => n + u.calls, 0), inputTokens, outputTokens: used.reduce((n, u) => n + u.output_tokens, 0),
      usd: +(inputTokens * USD_PER_INPUT_TOKEN).toFixed(6), msPerCase: report.cases.map(c => c.ms),
    };
  }

  async function main() {
    const out = document.getElementById("out");
    const sets = (new URLSearchParams(location.search).get("set") || "smoke").split(",");
    const key = (await chrome.storage.session.get(J.KEY))[J.KEY];
    if (!key) { out.textContent = "No Jev key in this browser session. Save one in My Info, then reload this page."; return; }
    const report = { sets, model: J.MODEL, startedAt: new Date().toISOString(), cases: [] };
    for (const c of globalThis.JEV_CASES.filter(c => sets.includes(c.set) || sets.includes(c.id))) {
      report.cases.push(await runCase(c, key));
      out.textContent = JSON.stringify(summarize(report), null, 2);
    }
    report.summary = summarize(report);
    out.textContent = JSON.stringify(report.summary, null, 2) + "\n\nPosting report…";
    try {
      await fetch(`http://127.0.0.1:8771/${sets.join("+")}`, { method: "POST", body: JSON.stringify(report) });
      out.textContent += " saved.";
    } catch { out.textContent += " collector unreachable; the summary above is all that was kept."; }
  }

  globalThis.JEV_GRADE = grade;
  if (globalThis.chrome?.storage?.session) main();
})();
