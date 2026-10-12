# First-run setup

The extension opens `onboarding.html` on install. Reopen it any time from **Run setup again** in My Info.

Steps: welcome, Google sign-in, Jev key, resume and profile import, contact, work history, education, work authorization, voluntary self-ID, summary. Every step except the first and last can be skipped.

- Progress (current step and skipped steps) is kept in `avidOnboarding` in extension storage, so closing the tab resumes where you left off.
- Profile steps read and write the same `avidProfile` as My Info, saving as you type. Existing data is prefilled and never overwritten by an untouched step.
- Google uses the same one-click connect as My Info. The account email only fills an empty email field.
- Jev: the key is checked with one tiny request (`AVID_JEV_VERIFY`) and stored only if Jev accepts it. It is stored and sent exactly as in My Info.

## Resume parsing

Choosing a resume (PDF or DOCX) on the resume step, or in My Info, reads it on the device and offers to fill the profile. The **Read it again** and **Fill my info from resume** buttons rerun it on the saved file.

- PDF text comes from pdf.js, loaded only when a PDF is chosen. DOCX is unzipped with the browser's built-in inflate. Nothing is uploaded and no AI or paid service is used.
- `src/shared/resume-parse.js` turns the text into contact details, links, jobs (anchored on date ranges), schools (anchored on school and degree words) and skills. It leaves a field blank rather than guess.
- A review dialog shows each value next to what the profile already holds. Values for empty fields are ticked; ones that would replace saved data are not. Roles and schools already saved are skipped, everything is editable, and nothing is written until **Add to my profile**.
- Scanned (image-only) PDFs and old `.doc` files cannot be read; the user is told and can type details in.
