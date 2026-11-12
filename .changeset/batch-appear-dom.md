---
"@wardic/dom": minor
---

`@wardic/dom/Appear` samples one rule for a Batch's members (`batchKeyframes`), each member's own values read from custom properties on its element, and a render's sheet gives them one slot (`sheet.batch`), each member its style with its own delay. At the Handoff, `matchesBatch` checks a member's animation against the client's transitions, and `findAll` reads every Appear animation on a page in one call.
