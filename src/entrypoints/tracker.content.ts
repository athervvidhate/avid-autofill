// Job tracker script the background registers at runtime on job boards
// (see trackerModel.SCRIPTS). It is not listed in the manifest.
import { defineContentScript } from "wxt/utils/define-content-script";
import "../shared/tracker-model.js";
import "../content/job-detector.js";
import "../content/tracker.js";

export default defineContentScript({
  registration: "runtime",
  main() {},
});
