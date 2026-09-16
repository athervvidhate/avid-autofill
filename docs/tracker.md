# Application tracker

Set up Google Sheets in **My Info → Connections**. The connection creates a
spreadsheet named **Job applications** with an **Applications** tab. Avid saves
the Google account, spreadsheet ID, numeric tab ID, and template version in this
browser. Subsequent saves use that configuration. Reconnecting does not create a
replacement for a missing or inaccessible sheet.

Enable **Ask to track submitted applications** and allow access to HTTP and HTTPS
pages. This lets a small detector run on company career pages and unfamiliar
sites without starting autofill. Turning the switch off unregisters automatic
injection and stops existing observers. The manual **Track application** button
remains available in the autofill drawer, including through the toolbar action.

After explicit submission confirmation, a small prompt asks whether to add the
application. Company and role are editable and required. Expand **Details and
notes** to edit the URL, location, dates, status, or notes. Filling a form,
clicking Submit, uploading a resume, and seeing a generic thank-you message are
not confirmation. If detection misses a page, use the manual button and choose
the correct status.

The tracker uses DOM selectors, structured JobPosting metadata, URL rules, and
explicit confirmation phrases. It makes no AI requests. It does not read
applicant input values, upload a resume, or send page text to Google. Only
approved tracker fields leave the browser.

## Spreadsheet layout

| Column | Initial value |
| --- | --- |
| Company | Extracted company, editable |
| Role | Extracted title, editable |
| Job URL | Posting URL with common tracking and session parameters removed |
| Location | Extracted location, when available |
| Date applied | Local date when submission is confirmed |
| Status | Applied for confirmed submissions, Saved for manual entries |
| Follow-up date | Seven days after a confirmed submission |
| Notes | Blank |

The sheet has a dark green header, frozen header and company/role columns,
alternating row colors, filters, clickable job links, and a status dropdown.
Date applied and Follow-up date store Google Sheets numeric date values and use
Google's date formatting. Statuses are Saved, In progress,
Applied, Interview, Offer, Rejected, and Withdrawn. Overdue follow-up dates are
highlighted unless the application has reached Offer, Rejected, or Withdrawn.

Two hidden columns hold the application ID and job key. The filter includes
these columns so sorting keeps them with the row. Keep the original header names
and column order. You can edit statuses, notes, dates, and other existing row
values directly in Sheets; Avid does not overwrite those rows. The numeric tab
ID also allows the tab to be renamed.

## Saving, dismissal, and retries

An Add action first stores the approved entry locally. If Google is unavailable,
the prompt and Connections show **Not synced yet**. A browser alarm retries every
two minutes while connected. Reconnect in Connections if Google needs sign-in or
consent. No sign-in window opens automatically during browsing.

Each write appends the row and creates a unique developer-metadata marker in
the same atomic Sheets request. A retry checks the marker and existing rows.
This handles an interrupted worker or a lost response without appending the same
entry again. Entries and their identifiers survive browser restarts. Network
failures never turn a queued entry into a reported success.

Revisiting a tracked or dismissed posting does not trigger another automatic
prompt. The manual button still works. Choose **Add another application** to
record an intentional reapplication. Disconnect stops syncing and clears the
cached token, while keeping the sheet configuration and pending entries. The
original account is required when reconnecting, so queued data cannot silently
move to another Google account.

## Google connection setup

A release needs one Google OAuth web client configured by its maintainer. End
users then only connect their Google account. An unpacked build also supports
saving that public client ID in Connections.

1. Create or choose a project in [Google Cloud](https://console.cloud.google.com/).
   Enable **Google Sheets API** and **Google Drive API**.
2. Configure Google Auth Platform branding and audience. For a testing app, add
   the account used for testing to its test users.
3. Create an OAuth client of type **Web application**. Register the exact
   **Authorized redirect URI** displayed in Connections. It has the form
   `https://<extension-id>.chromiumapp.org/google`.
4. Configure `https://www.googleapis.com/auth/drive.file`, `openid`, and `email`.
   The file scope limits access to files used with this app. Identity scopes
   identify the selected account so reconnection cannot switch the save target.
5. Save the public client ID in Connections. For a release, put it in
   `src/background/google-config.js` and keep the packaged extension ID stable.
   Each separately distributed extension ID needs its redirect URI registered.
6. Click **Connect Google and create tracker**, complete Google's consent, then
   enable automatic tracking. Open the tracker to inspect the created sheet.

Do not put a client secret in the extension. Authentication uses
`chrome.identity.launchWebAuthFlow` and Google's client-side OAuth flow, avoiding
Chrome-profile-only token APIs. Access tokens live in `chrome.storage.session`,
which is unavailable to content scripts by default. Avid checks the redirect,
OAuth state, granted scopes, and account identity. Expired access can be renewed
silently when Google allows it; otherwise Connections asks you to reconnect.

The implementation targets Chromium browsers with Manifest V3 identity,
scripting, storage.session, and alarms support. The automated browser smoke test
runs in an isolated Brave profile. Live Google consent and API writes require a
configured OAuth client and a real account; local tests do not prove those steps.

References: [Chromium identity](https://developer.chrome.com/docs/extensions/reference/api/identity),
[Google client-side OAuth](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow),
[file access scope](https://developers.google.com/workspace/sheets/api/scopes),
[atomic Sheets updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate),
[unique metadata IDs](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.developerMetadata).

## Verification and limits

Run `npm test` for the existing autofill tests and tracker regression checks.
Run `node test/tracker-browser.mjs` for the isolated Brave test, or set
`AVID_BROWSER` to another Chromium executable. The browser test grants host
access in a temporary extension copy because headless mode cannot operate the
native permission dialog. It checks actual registration, full-page submission
navigation without autofill, the prompt, local saves, and Connections. It never
uses a personal browser profile or a Google account.

Detection is best effort, currently using English submission phrases. Job
metadata must be captured in the same tab, or present on the confirmation page.
Contexts expire after two hours. Generic thank-you screens, closed tabs,
cross-origin flows without a useful referrer, inaccessible frames, and unknown
site structures may require the manual button. Review extracted details before
adding a row. The detector does not claim to recognize every site.

Before shipping, test Google consent, spreadsheet creation, row formatting, token
expiry and reconnect, and a real submission on each supported browser. Also test
the optional host-permission prompt outside headless mode. No application needs
to be submitted solely for testing; use an application you intended to send.
