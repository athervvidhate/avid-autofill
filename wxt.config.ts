import { defineConfig } from "wxt";

// Content scripts and pages are declared by their entrypoints in src/entrypoints.
// Everything else that used to live in manifest.json is declared here.
export default defineConfig({
  srcDir: "src",
  // Keep the existing scripts readable globals rather than auto-imported helpers.
  imports: false,
  manifest: {
    name: "Avid Autofill for Job Applications",
    description:
      "Autofill job applications on Greenhouse, Lever, Ashby, Workday and more from your saved profile. You review before submitting.",
    permissions: ["storage", "activeTab", "scripting", "unlimitedStorage", "identity", "alarms"],
    host_permissions: [
      "https://sheets.googleapis.com/*",
      "https://www.googleapis.com/*",
      "https://openidconnect.googleapis.com/*",
    ],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_title: "Open Avid Autofill",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
  },
});
