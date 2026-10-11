# First-run setup

The extension opens `onboarding.html` on install. Reopen it any time from **Run setup again** in My Info.

Steps: welcome, Google sign-in, Jev key, resume and profile import, contact, work history, education, work authorization, voluntary self-ID, summary. Every step except the first and last can be skipped.

- Progress (current step and skipped steps) is kept in `avidOnboarding` in extension storage, so closing the tab resumes where you left off.
- Profile steps read and write the same `avidProfile` as My Info, saving as you type. Existing data is prefilled and never overwritten by an untouched step.
- Google uses the same one-click connect as My Info. The account email only fills an empty email field.
- Jev: the key is checked with one tiny request (`AVID_JEV_VERIFY`) and stored only if Jev accepts it. It is stored and sent exactly as in My Info.
