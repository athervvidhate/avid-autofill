import { defineConfig } from "wxt";

// Content scripts and pages are declared by their entrypoints in src/entrypoints.
// Everything else that used to live in manifest.json is declared here.
export default defineConfig({
  srcDir: "src",
  // Keep the existing scripts readable globals rather than auto-imported helpers.
  imports: false,
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
