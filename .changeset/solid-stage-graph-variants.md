---
"@wardic/solid": minor
---

Variants down a scene's graph (#885): a Stage whose Environment gives its ward a **`StageGraph`** (a Subject's parent, its moves, its place among an ancestor's children, and its descendants) hands variants down that graph, not Solid's component tree.

- A ward on a Stage's Subject with `variants` and no names of its own follows the nearest ward above its Subject: it starts at the name that ward's `initial` hands down, and moves with its `animate`.
- Its stagger slot is its place among that ward's Subject's children, whatever order the wards mounted in.
- Moved to another parent, it follows the ward above it there; a ward above it that starts later is followed then.
- A material, a uniforms object, a ward with names of its own, and one with `inherit: false` follow no one.

`StageMembership` gains `parentOf`, the parent a Scene object will join, where it looks for the ward it follows before it has joined. A Stage with no graph is as before; the page's wards are unchanged. Solid 2 only.
