# Avid Autofill

A Chrome extension that autofills job application forms from a profile you save
once. Same idea as Jobright Autopilot / Simplify, rebuilt from scratch so it's
yours to change. It fills structured fields (name, contact, links, current role,
education, work authorization, salary) and always stops before submitting — you
review, then send.

## How it works

- **Content script** runs on every page and, on request, scans the form.
- **Matcher** (`src/content/matcher.js`) reads each field's label, name, id,
  placeholder, aria-label, and nearby text, then maps it to a profile value via
  an ordered rules table.
- **Fillers** (`src/content/fillers.js`) fill text via `execCommand("insertText")`
  — the real browser input pipeline — falling back to the native setter. This
  matters for strict React forms like Workday, which mark a field empty for
  validation unless the value arrives through genuine `beforeinput`/`InputEvent`
  (the reason "type one letter" fixes a visually-filled-but-rejected field).
  Also handles textarea, native `<select>`, radios, checkboxes, react-select /
  ARIA combobox / Workday button-listbox dropdowns, and US state abbreviation
  expansion (CA ↔ California) for pickers.
- **Adapters** (`src/content/adapters.js`) detect the ATS (Greenhouse, Lever,
  Ashby fully; Workday in beta; iCIMS / Taleo / Workable detected with generic
  fill) and point the engine at that ATS's custom dropdowns.
- **Profile** lives in `chrome.storage.local` — edit it in the options page, or
  seed it from your career-ops files (below). Nothing leaves your machine.

## Setup

1. **Seed your profile from career-ops** (optional but recommended):
   ```bash
   npm install
   npm run import            # reads ../career-ops/cv.md + config/profile.yml
   # or: npm run import -- /path/to/career-ops
   ```
   This writes `profile.json`.

2. **Load the extension:**
   - Go to `chrome://extensions`
   - Toggle **Developer mode** (top right)
   - Click **Load unpacked** and select this folder (`~/Projects/avid-autofill`)

3. **Load your data:** the options page opens on install. Click
   **Import profile.json**, review the fields, and **Save**. You can also type
   everything directly instead of importing.

4. **Try it:** open `test/sample-form.html` in Chrome, click the extension icon,
   then **Fill this page**. Then use it on a real Greenhouse/Lever/Ashby posting.

## Using it

- Click the toolbar icon on any application page. The badge shows the detected ATS.
- **Fill this page** fills what it recognizes and lists every field it touched
  (green = filled, amber = kept existing / no match). **Review before submitting.**
- Toggles: *Overwrite filled fields* (off by default) and *Fill voluntary self-ID
  (EEO)* (off by default — EEO is only filled when you opt in).

## Resume upload

Save your resume once on the options page (**Resume → Choose resume**). It's
stored as base64 in `chrome.storage.local` (never leaves your machine). On fill,
the content script reconstructs a `File`, assigns it via a `DataTransfer` to the
page's `input[type=file]` (the only way to set a file programmatically — direct
`input.files` assignment is blocked), and dispatches `change` so the ATS's own
upload handler fires. Drag-and-drop-only zones get a synthetic `drop` event.

This is exactly how Simplify/Jobright do it: the browser can't read your disk
during autofill, so the resume has to live in the extension first.

## Common application questions

The options page has default answers for recurring yes/no questions (previously
employed here, current student, sponsorship, SMS consent, "consider me for other
roles", legal acknowledgments). These fill Tesla-style legal/eligibility steps.
Acknowledgment checkboxes are auto-checked — you still review before submitting.

## What it does not do (by design / yet)

- **Never submits.** It fills; you click submit. This is intentional.
- **Open-ended questions** ("Why this company?") are left blank for now. The AI
  layer (draft answers from your profile via the Claude API) is phase 2.
- **iCIMS / Taleo / Workable:** detected and given a best-effort generic fill;
  their custom widgets and multi-step flows need live-page tuning (phase 2).

## Workday (beta)

Workday is a SPA where every field carries a `data-automation-id` and nothing is
a native control. Support works by:

- **De-camelCasing identifiers** into the match signal, so `legalNameSection_firstName`
  reads as "legal name section first name" and hits the same rules as a plain label.
  This alone fills most text fields (name, address, city, postal, phone, email).
- **Button-listbox dropdowns** (`button[aria-haspopup="listbox"]`) opened and
  matched against `div[data-automation-id="promptOption"]` — including the yes/no
  legal/eligibility questions, whose text lives in the button's `aria-label`.
- **Typeable date sections** (`dateSectionMonth/Day/Year-input`) filled from parsed
  dates (`src/content/workday.js`).

Workday applications are **multi-step** — click *Fill this page* on each step
(My Information, Experience, Application Questions...). Not yet handled: the
calendar-popover date variant (work-experience start/end), and multi-panel
"Add Another" work-history repeaters. Test on a real posting and tell me what
misses — the automation-ids are stable across companies, so fixes generalize.

## Roadmap

1. ~~Phase 1: engine + Greenhouse/Lever/Ashby + repo import + options UI~~ ✅
2. ~~Resume upload (DataTransfer) + common yes/no + legal-acknowledgment fields~~ ✅
3. ~~Phase 2a: Workday adapter — de-camel signals, button-listboxes, date sections~~ ✅ (beta)
4. Phase 2b: iCIMS / Taleo / Workable adapters; Workday calendar dates + work-history repeaters
5. Phase 2c: AI layer for open-ended questions (Claude API, opt-in, key stored locally)
6. Later: per-site field-mapping overrides, multi-profile

## Project layout

```
manifest.json                 MV3 config
src/shared/schema.js          profile shape + storage helpers (shared by all pages)
src/content/                  fillers, matcher, adapters, engine, message entry
src/popup/                    toolbar popup (Fill button + results)
src/options/                  profile editor + JSON import/export
src/background/               service worker (opens options on install)
build/import-from-career-ops.mjs   cv.md + profile.yml -> profile.json
test/sample-form.html         local test fixture
```
