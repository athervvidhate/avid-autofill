import { defineConfig } from "wxt";

// Content scripts and pages are declared by their entrypoints in src/entrypoints.
// Everything else that used to live in manifest.json is declared here.
export default defineConfig({
  srcDir: "src",
  // Keep the existing scripts readable globals rather than auto-imported helpers.
  imports: false,
  hooks: {
    // WXT writes options_ui; keep the options_page key the extension has always used.
    "build:manifestGenerated": (_wxt, manifest) => {
      if (manifest.options_ui) {
        manifest.options_page = manifest.options_ui.page;
        delete manifest.options_ui;
      }
      // Only store installs carry update_url, and the drawer uses that to pick Report a problem
      // over Export DOM. AVID_STORE_PREVIEW=1 npm run build fakes it to try the store drawer locally.
      if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AVID_STORE_PREVIEW) manifest.update_url = "https://clients2.google.com/service/update2/crx";
    },
  },
  manifest: {
    name: "Avid Autofill for Job Applications",
    // Pins the extension ID (hlakbjlejclnadcmikjpinjkagkkjgpn) for dev, local builds and releases,
    // so the Google OAuth redirect URI https://<id>.chromiumapp.org/google never changes.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA88mo+BDlhOWZRc0lRECzoy6YMLsVhtD5a1+W6s/AMAdUFXC9MGGS61XdP1k5hSAgIt3BPO6BgflZYdd5GZ7faneFVBsjQI74CsfeXiF8v0Xg2RXuX1FPM69pPYPLYBgaiOGZPnoMP8NtG0vOo9G0FhZ7yx3kq5DoYTqgey47tsnhcND5+9Wq/wgLD5Hpr5GP5ZSNgHsbJpCUZRDR3Gqi8VNYwzew+IkNxpGQXOE5AzlAqUwgQPXRyp4eR+94hZg+O3N4dbK4eyDLxn9OzK1pDOHpLYtpjQqO3jIZ8y6TCGN96uCXQgn9gMGkItxGM3v7Vklx5Gk/WFiGTccqmurG+QIDAQAB",
    description:
      "Autofill job applications on Greenhouse, Lever, Ashby, Workday and more from your saved profile. You review before submitting.",
    permissions: ["storage", "activeTab", "scripting", "unlimitedStorage", "identity", "alarms"],
    host_permissions: [
      "https://sheets.googleapis.com/*",
      "https://www.googleapis.com/*",
      "https://openidconnect.googleapis.com/*",
    ],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    // The drawer's fonts, loaded by the content script into the page it runs on.
    web_accessible_resources: [{ resources: ["fonts/*.woff2"], matches: ["<all_urls>"], use_dynamic_url: true }],
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
