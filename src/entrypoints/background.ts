// Service worker. These scripts used to be pulled in with importScripts and
// still run in this order, attaching to globalThis.
import { defineBackground } from "wxt/utils/define-background";
import "../shared/schema.js";
import "../shared/jev.js";
import "../shared/skills.js";
import "../background/jev.js";
import "../shared/tracker-model.js";
import "../background/google-config.js";
import "../background/tracker.js";
import "../background/anysite.js";
import "../background/service-worker.js";

export default defineBackground(() => {});
