# Changelog

Versions follow [semantic versioning](https://semver.org): a new feature raises the
minor number, a fix raises the patch number. Changes land under **Unreleased**; a
release moves them under a version heading, bumps `version` in `package.json`
(WXT copies it into the manifest) and tags `vX.Y.Z`.

## Unreleased

## 0.2.0 (2026-10-12)

- Optional profile sync across your Chrome browsers through Chrome's own sync, turned on in Connections. The resume file, Jev key and settings stay on each device.
- Work history and education rows each get their own entry. Jobs and schools already on the form are left alone, and missing ones get a new row through the form's Add another button.
- Read a resume on device during setup or in My Info to fill the profile.
- A Report a problem button for store builds.
- Copy info lists company, role, then description first.
- After you click Fill once, Avid fills each later application page as it appears, so you no longer click Fill on every step. Turn it off with *Fill each new step automatically* in the drawer or toolbar popup.

## 0.1.0

- First build: Greenhouse, Lever, Ashby, Workday and generic form filling; Jev matching of saved answers; Google Sheets application tracker; first-run onboarding; green redesign.
