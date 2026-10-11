// The page content script: detection, filling and the drawer.
// The imported scripts still attach to globalThis.AvidAutofill and depend on
// running in this order, the same order manifest.json used to list them.
import { defineContentScript } from "wxt/utils/define-content-script";
import "../shared/schema.js";
import "../shared/tracker-model.js";
import "../shared/skills.js";
import "../content/job-detector.js";
import "../content/tracker.js";
import "../content/fillers.js";
import "../content/generic.js";
import "../content/matcher.js";
import "../content/adapters.js";
import "../content/workday.js";
import "../content/jev.js";
import "../content/engine.js";
import "../content/widget.js";
import "../content/main.js";

export default defineContentScript({
  matches: [
    "*://*.greenhouse.io/*",
    "*://*.lever.co/*",
    "*://*.ashbyhq.com/*",
    "*://*.myworkdayjobs.com/*",
    "*://*.icims.com/*",
    "*://*.taleo.net/*",
    "*://*.workable.com/*",
    "*://*.smartrecruiters.com/*",
    "file:///*",
  ],
  runAt: "document_idle",
  allFrames: true,
  main() {},
});
