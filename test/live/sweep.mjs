// Replays live-evaluation reports under candidate acceptance thresholds, so a
// gate is chosen from measured wrong fills and coverage rather than by guess.
//   node test/live/sweep.mjs <report.json>...
import { readFileSync } from "node:fs";

const KIND = { email: id => id === "personal_email", tel: id => id === "personal_phone", url: id => id.startsWith("links_") };
const fields = process.argv.slice(2).flatMap(file => JSON.parse(readFileSync(file, "utf8")).cases.flatMap(c => (c.fields || []).map(f => ({ ...f, case: c.id }))));

function decide(field, metric, t) {
  const pass = stage => stage && stage.choice !== "NEEDS_USER" && stage[metric] >= t;
  if (!pass(field.stage1) || KIND[field.type] && !KIND[field.type](field.stage1.choice)) return null;
  if (!field.expect?.option && !["select", "radio"].includes(field.type)) return { sourceId: field.stage1.choice };
  return pass(field.stage2) ? { optionId: field.stage2.choice } : null;
}
function outcome(field, fill) {
  if (field.expect === null) return fill ? "wrong-fill" : "correct-abstain";
  if (!fill) return "missed";
  return (field.expect.option ? fill.optionId === field.expect.option : [].concat(field.expect).includes(fill.sourceId)) ? "correct" : "wrong-fill";
}

const fillable = fields.filter(f => f.expect !== null).length;
console.log(`${fields.length} fields, ${fillable} fillable`);
for (const metric of ["p", "confidence"]) {
  console.log(`\nmetric=${metric}\n  t     correct  wrong  missed  abstain  coverage`);
  for (const t of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
    const n = { correct: 0, "wrong-fill": 0, missed: 0, "correct-abstain": 0 };
    for (const f of fields) n[outcome(f, decide(f, metric, t))]++;
    console.log(`  ${t.toFixed(2)}  ${String(n.correct).padStart(7)}  ${String(n["wrong-fill"]).padStart(5)}  ${String(n.missed).padStart(6)}  ${String(n["correct-abstain"]).padStart(7)}  ${(n.correct / fillable * 100).toFixed(0).padStart(7)}%`);
  }
}
const wrong = fields.filter(f => outcome(f, decide(f, "p", 0)) === "wrong-fill");
console.log(`\nWrong picks at any threshold (p shown):`);
for (const f of wrong) console.log(`  ${f.case}/${f.id} [${f.tag}] ${f.label.slice(0, 70)} -> s1 ${f.stage1?.choice} ${f.stage1?.p}${f.stage2 ? `, s2 ${f.stage2.choice} ${f.stage2.p}` : ""} (expect ${JSON.stringify(f.expect)})`);
