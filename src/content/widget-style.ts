// Hands the drawer its stylesheet. The drawer is a classic script, so it reads this
// from the shared namespace when it mounts instead of importing the CSS itself.
import css from "./widget.css?raw";

globalThis.AvidAutofill = globalThis.AvidAutofill || {};
globalThis.AvidAutofill.widgetStyle = css;
