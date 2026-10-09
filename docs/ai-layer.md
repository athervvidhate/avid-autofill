# AI layer

The first implementation uses Jev to select approved saved answers for unmatched
native fields. See [Jev setup, requests, validation, and implementation](jev.md).
It is experimental, off by default, direct to TypeSafe AI, and uses a key held in
trusted extension session storage. Existing structured autofill remains local.

Generating new answers to open-ended questions is not implemented. A future
writing feature should use only approved profile facts, keep invented claims out,
and show the draft for editing before insertion. Bringing a user's own key and
clearly disclosing the context sent to the provider remain requirements.
