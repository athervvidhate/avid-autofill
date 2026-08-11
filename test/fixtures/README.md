# Captured ATS fixtures

Real, saved-from-a-live-session application forms, used by the Phase 4 regression
suite. Auth-walled ATS (Workday, iCIMS, …) can only be captured from a logged-in
session, so these come from the maintainer's own runs.

## How to capture one

1. Load the extension unpacked (dev build). The widget's **Export DOM** button only
   appears in dev builds — store users never see it.
2. Open a real application form and reach the step you want to snapshot.
3. Open the Autofill widget, type a `step` label (e.g. `page1`), and click
   **Export DOM**. A `{ats}-{step}.html` file downloads.
4. Move it into this directory.

## What the export does

- Clears everything you typed (input/checkbox/select values) so the fixture is a
  blank form, not your filled-in one.
- Redacts any of your saved profile values (name, email, phone, address, links)
  that the page had server-rendered into the HTML.
- Strips the extension's own widget and page `<script>` tags.

The scrub is **best-effort**. Skim the file before committing it and remove any PII
the automatic pass missed.

## Naming

`{ats}-{step}.html`, lowercased — e.g. `workday-page1.html`, `greenhouse-eeo.html`.
