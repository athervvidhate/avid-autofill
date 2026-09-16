<div align="center">

<img src="icons/icon-128.png" width="88" height="88" alt="Avid Autofill" />

# Avid Autofill

**One-click autofill for job applications, right where you apply.**

Open a posting on Greenhouse, Lever, Ashby, Workday and more, and a small panel
appears. Click once and your name, contact, links, work history, education,
work authorization, resume, and the usual yes/no questions are filled in. You
review, then submit. Your data lives in your browser, not on someone's server.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34a853.svg)](manifest.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-6b93ff.svg)](#contributing)
![Privacy: local-only](https://img.shields.io/badge/data-local--only-12894a.svg)

</div>

---

## Why

Job seekers retype the same fifteen fields into a dozen different applicant
tracking systems every week. Existing autofillers work, but they route your
personal data through a third-party account. Avid Autofill does the same job
with a different contract: **today it holds your profile locally and talks to no
server.** It is open source so you can verify that, and hackable so you can bend
the field matching to your own search. If cloud features arrive later (see
[Privacy](#privacy)), they will be opt-in and local-first will remain the
default.

## Features

- **Page drawer** - a right-edge drawer stays beside supported job sites; click
  *Fill this application* and review each field that was filled or skipped.
- **Smart field matching** - reads each field's label, name, id, placeholder,
  `aria-label`, and nearby text, de-camelCases identifier-style attributes, and
  maps them to your profile with an ordered rules table. No brittle per-site
  hardcoding for the common fields.
- **Handles framework-controlled inputs** - uses browser input events and
  `execCommand("insertText")` where a direct value assignment would be ignored.
  Workday remains beta and needs a live check when its form widgets change.
- **Resume upload** - injects your saved resume into the file input via
  `DataTransfer`, the only sanctioned way to set a file programmatically.
- **Common questions** - default answers for the recurring yes/no and legal
  acknowledgment questions (sponsorship, prior employment, student status, SMS
  consent, "consider me for other roles").
- **Local and private** - today everything lives in `chrome.storage.local`. No
  account, no network calls, no telemetry.
- **Review-first by design** - it fills, you submit. It never clicks the final
  button.

## Supported platforms

| ATS | Status |
| --- | --- |
| Greenhouse | Beta; adapter present, live fixture hardening pending |
| Lever | Beta; adapter present, live fixture hardening pending |
| Ashby | Beta; adapter present, live fixture hardening pending |
| Workday | Beta; typeable dates and work-history repeaters need live validation |
| iCIMS, Taleo | Detected; generic fill only |
| Workable, SmartRecruiters | Detected; generic fill with ARIA dropdown support |

Company-embedded ATS on custom domains and more platforms are on the
[roadmap](#roadmap). Open an issue with a posting URL if one you use is missing.

## Install (from source)

Until the Chrome Web Store listing is live, load it unpacked:

```bash
git clone https://github.com/athervvidhate/avid-autofill.git
cd avid-autofill
```

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** and select the `avid-autofill` folder
4. The My Info page opens - add your details, or import a profile (below)

## Usage

1. Add your info on the My Info page (name, contact, links, work history,
   education, resume, common answers). It is saved locally.
2. Open a job application on a supported site. The Avid drawer opens on the
   right side of the page.
3. Click **Fill this application**. Review the result, attach anything the
   extension could not (see limits), and submit yourself.

Multi-step flows (Workday) fill one step at a time: click *Autofill* on each
step as you advance.

### Import a profile

You can type everything into the options page, or import a `profile.json`. If you
keep your data in structured files, the included script converts them:

```bash
npm install
npm run import -- /path/to/your/data   # writes profile.json
```

Then open the My Info page and **Import JSON**.

## How it works

```
content script (supported sites only)
  schema      profile shape + chrome.storage helpers
  matcher     field signal extraction + rules table
  fillers     React-safe text/select/radio/file setters
  adapters    ATS detection + per-ATS dropdown selectors
  workday     Workday date-section handling
  engine      orchestration: detect, match, fill, report
  widget      page drawer UI (rendered in a shadow root)
```

The content script runs automatically on listed ATS domains. On another HTTP or
file page, clicking the toolbar icon grants temporary access and opens the
drawer. The drawer renders inside a shadow root, so the host page's styles never
touch it and its styles never leak out.

## Privacy

**Today:** Avid Autofill stores your profile and resume in `chrome.storage.local`
on your machine. It makes no network requests, has no analytics, has no account,
and has no backend. The resume is held as bytes so it can be injected into a file
input; browsers cannot read files off your disk during autofill, which is why it
must be saved once in the extension first.

**Going forward:** optional cloud features may be added later, such as syncing
your profile across devices or drafting answers to open-ended questions with an
LLM. These will always be:

- **Opt-in** - off by default; local-only stays the default experience.
- **Disclosed** - clearly stated what leaves your device and where it goes.
- **BYOK-friendly** - for any AI feature, bringing your own provider key (request
  goes straight from your browser to the provider, no server of ours in the
  middle) will always remain available, even if a hosted option also exists.

The extension is open source, so you can verify exactly what it does at any
version.

## Limits

- **Never submits.** By design.
- **File inputs** need the resume saved in the extension first (browser
  security). Drag-and-drop-only zones are best-effort.
- **Open-ended questions** ("Why this company?") are left blank; an optional,
  local AI draft layer is on the roadmap.
- **Workday** calendar-popover-only dates are not handled. Multi-panel work
  history is implemented and fixture-tested, but still needs a live pass with
  multiple entries. Use the page drawer; it keeps the fill action in the same
  user-initiated page context as the form.

## Roadmap

- [x] Greenhouse / Lever / Ashby adapters
- [x] Resume upload, common yes/no + legal-acknowledgment fields
- [x] Workday beta: de-camelCased ids, button-listbox dropdowns, typeable dates
- [x] Workday work-history repeaters (fixture-tested; live hardening pending)
- [x] On-demand in-page widget with narrowed host permissions
- [ ] iCIMS / Taleo / Workable / SmartRecruiters full adapters
- [ ] Workday calendar-popover-only dates
- [ ] Optional local AI layer for open-ended questions
- [ ] Per-site field-mapping overrides and multiple profiles
- [ ] Chrome Web Store release

See [open issues](https://github.com/athervvidhate/avid-autofill/issues) for the
current queue.

## Contributing

Contributions are welcome. Adding an ATS adapter or a field-matching rule is a
great first PR:

- **New ATS**: add a detector and its custom-dropdown selectors in
  `src/content/adapters.js`. If it uses a novel widget, add a filler in
  `src/content/fillers.js`.
- **New field**: add a rule to the table in `src/content/matcher.js`. Rules are
  ordered, most-specific first, and can exclude false matches.

Please include a posting URL (or a sanitized DOM snippet) demonstrating the fix.
There is a local test fixture at `test/sample-form.html` for exercising the
matcher and fillers without hitting a live ATS.

## License

[MIT](LICENSE) (c) Atherv Vidhate
