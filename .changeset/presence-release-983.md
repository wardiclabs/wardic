---
"@wardic/dom": patch
---

A `mode="wait"` presence's held child whose start throws no longer fails silently (#983). On Solid 1, a held element whose function variant threw as it finally started (one reading state that changed while it was held) threw out of the presence's release, with nothing logged.

- **Reported,** as `wardic.presence: mode="wait"'s release failed`, with the error as its cause, to the console and the app's error reporters, and the presence goes on.
- **Under `propagate`,** an inner presence is always torn down once its children have left, though the parent's release throws.
- **Solid 2 and Foldkit** release held children later, so this throw couldn't happen there.
