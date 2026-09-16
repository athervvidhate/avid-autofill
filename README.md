<div align="center">

<img src="icons/icon-128.png" width="88" height="88" alt="Avid Autofill" />

# Avid Autofill

**One-click autofill for job applications, right where you apply.**

Open a posting on Greenhouse, Lever, Ashby, Workday and more, and a small panel
appears. Click once and your name, contact, links, work history, education,
work authorization, resume, and the usual yes/no questions are filled in. You
review, then submit. Your profile lives in your browser. An optional Google Sheets
connection tracks applications after you approve each entry.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34a853.svg)](manifest.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-6b93ff.svg)](#contributing)
![Privacy: local profile](https://img.shields.io/badge/profile-local-12894a.svg)

</div>

---

## Why

Job seekers retype the same fifteen fields into a dozen different applicant
tracking systems every week. Existing autofillers work, but they route your
personal data through a third-party account. Avid Autofill does the same job
with a different contract: **your profile and resume stay in your browser.**
The optional application tracker sends only the job details you approve directly
to your Google spreadsheet. It is open source so you can verify that and change
the field matching for your own search.

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
- **Local profile** - your profile and resume live in `chrome.storage.local`.
  Autofill needs no account. No telemetry.
- **Application tracker** - connect Google Sheets through Connections to create
  a formatted tracker. After confirmed submission, a small prompt lets you review
  and save the job. Optional broader site access covers company career pages and
  unfamiliar sites even when you never use autofill. Parsing and spreadsheet
  operations are deterministic, with no AI. Approved entries stay local until
  Google confirms the save.
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

### Track applications in Google Sheets

Open **My Info → Connections**, connect Google, and create your tracker. Enable
**Ask to track submitted applications** and grant page access for automatic
detection beyond the listed job platforms. The sheet includes company, role,
job URL, location, application date, status, follow-up date, and notes.

Use **Track application** in the drawer when automatic detection misses a page.
Duplicate prompts are suppressed; intentional reapplications have an explicit
**Add another application** action. Failed saves remain visible in Connections
and retry while connected.

No Google Apps Script is needed. The extension writes to the spreadsheet through
the Google Sheets and Drive APIs. To connect a source build:

1. Create a project in [Google Cloud](https://console.cloud.google.com/) and
   enable the **Google Sheets API** and **Google Drive API**.
2. Configure the Google Auth Platform consent screen. Add your Google account as
   a test user if the app is still in testing.
3. In **My Info → Connections**, copy the redirect URL shown under Google
   setup. Create an OAuth client of type **Web application** and add that exact
   URL as an authorized redirect URI.
4. Copy the OAuth client ID into Connections. Do not create or add a client
   secret. Release builds can set the public client ID in
   `src/background/google-config.js` instead.
5. Click **Connect Google and create tracker**, approve access, then open the
   generated sheet.

See [tracker setup, behavior, and verification](docs/tracker.md) for the scopes,
privacy model, retry behavior, and release checklist.

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

**Autofill:** Avid Autofill stores your profile and resume in `chrome.storage.local`
on your machine. Autofill makes no network requests and needs no account.
The extension has no analytics or backend. The resume is held as bytes so it can be injected into a file
input; browsers cannot read files off your disk during autofill, which is why it
must be saved once in the extension first.

**Optional tracker:** Google sign-in and Sheets/Drive requests go directly to
Google. Approved tracker fields, including any notes you enter, are stored in
your spreadsheet. Applicant form values and your saved profile are not sent.
The account and sheet configuration, pending entries, and dismissal history are
stored locally. Access tokens stay in extension session storage, unavailable to
content scripts. Disconnecting stops syncing and keeps your sheet and pending
entries. Automatic detection requires optional HTTP/HTTPS page access and can
be turned off in Connections.

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
