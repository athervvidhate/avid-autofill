// The classic scripts share state through globalThis.AvidAutofill. Modules are
// typed here loosely until each one is converted to a TypeScript module.
export {};

declare global {
  var AvidAutofill: Record<string, any>;
  var AVID_GOOGLE_CLIENT_ID: string;
}
