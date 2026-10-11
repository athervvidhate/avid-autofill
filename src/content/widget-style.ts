/// <reference types="chrome" />
// Hands the drawer its stylesheet and fonts. The drawer is a classic script, so it reads
// these from the shared namespace when it mounts instead of importing them itself.
import css from "./widget.css?raw";

const FONTS: [family: string, file: string][] = [
  ["Avid Bricolage", "fonts/bricolage-grotesque.woff2"],
  ["Avid Figtree", "fonts/figtree.woff2"],
];
let fontsLoaded = false;

globalThis.AvidAutofill = globalThis.AvidAutofill || {};
globalThis.AvidAutofill.widgetStyle = css;
// @font-face does not apply inside a shadow root, so register the fonts on the page
// under names no site will use.
globalThis.AvidAutofill.loadWidgetFonts = () => {
  if (
    fontsLoaded ||
    typeof FontFace !== "function" ||
    !document.fonts ||
    typeof chrome === "undefined" ||
    !chrome.runtime?.getURL
  )
    return;
  fontsLoaded = true;
  for (const [family, file] of FONTS) {
    const face = new FontFace(family, `url(${chrome.runtime.getURL(file)})`, { weight: "200 900", display: "swap" });
    document.fonts.add(face);
    face.load().catch(() => {});
  }
};
