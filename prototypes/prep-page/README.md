# PROTOTYPE — Organizer prep page (throwaway)

Answers the Wayfinder ticket **What does the Organizer prep page look like?** (#11). Not production code.

Double-click `prep-page-prototype.html`. Flip variants with the pink bar or ← / →; `?variant=A|B|C` is shareable.

- **A — Single page:** one scrolling document: Competition → Rounds → Audience → Hand out.
- **B — Wizard:** four steps, one at a time, ending in a review screen, then export and the checklist.
- **C — Workbench:** a sidebar of Rounds with status, and one Round at a time next to what the Contestant will see.

Real: image dimensions, asset-name validation (awkward characters, case-insensitive duplicates), the 32 MB warning, credential minting, the Host console link, `dist/` folder import, and a stub Round package download through a pure `fillTemplate()`.
Fake: the Core Editor template. The download only shows what got baked in.
No persistence on purpose: a reload forgets everything (see the yellow banner).
