// Receives live-evaluation reports from the extension page and writes each one
// to <dir>/<set>-<timestamp>.json. Reports contain synthetic data only.
//   node test/live/collect.mjs [dir]
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";

const dir = process.argv[2] || "test/live/results";
mkdirSync(dir, { recursive: true });
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.end();
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    const file = `${dir}/${req.url.slice(1).replace(/[^\w+-]/g, "") || "report"}-${Date.now()}.json`;
    writeFileSync(file, body);
    console.log(file);
    res.end("saved");
  });
}).listen(8771, "127.0.0.1", () => console.log(`Collecting Jev reports in ${dir}`));
