# AI layer (design, not yet built)

Draft answers to open-ended application questions ("Why do you want to work
here?", "Describe a challenge...") from the user's saved profile.

Status: **design-only.** No code ships yet. This document records the decisions
so the eventual implementation stays consistent with the project's privacy stance.

## Principles

1. **BYOK, direct-to-provider.** The user supplies their own API key. The request
   goes straight from the browser to the provider (Anthropic first, others later).
   There is no backend of ours in the path.
2. **Local key storage.** The key lives in `chrome.storage.local`, same as the
   profile. It is never transmitted anywhere except to the chosen provider.
3. **Opt-in and off by default.** Structured autofill never depends on this. The
   AI layer only runs when the user enables it and only on fields the heuristic
   matcher leaves blank (open-ended text).
4. **Grounded, never fabricated.** The prompt is built from the user's profile
   (work history, skills, links) plus the job's own text. The model reframes and
   selects; it must not invent employers, titles, metrics, or claims the profile
   does not support.
5. **BYOK stays forever.** A hosted/paid tier may be offered later for
   convenience, but bringing your own key (or logging into your own provider)
   remains a first-class option indefinitely.

## Sketch

- **Settings:** provider dropdown, API key field, enable toggle, per-field cap.
- **Trigger:** in the widget, open-ended fields the matcher skipped get a "Draft"
  affordance; the user reviews and edits before it lands in the field.
- **Prompt shape:** system prompt sets the grounding rules; user message carries a
  compact profile summary + the question text + any length hint from the field.
- **Provider abstraction:** a thin adapter per provider so Anthropic can ship
  first and others slot in without touching the widget.

## Open questions

- Streaming into the field vs. draft-then-insert (leaning draft-then-insert, so
  the user always reviews).
- How much profile context to include without bloating tokens.
- Caching drafts per (question, profile version) to avoid repeat calls.

Tracked in the repo issues.
