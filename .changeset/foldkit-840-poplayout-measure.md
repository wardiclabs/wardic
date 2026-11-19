---
"@wardic/foldkit": patch
---

A `popLayout` leaver is pinned where it was before the patch (#840): a child swapped for another in one patch, a page under `w.Presence({ mode: "popLayout" })` for the next, was measured after Foldkit had put the entering child in above it, so it was pinned that much lower and a `layoutId` photo flew up from there. The binding now measures each `popLayout` presence's children as a view renders such a presence, before the render's patch; a presence pins its leavers before it starts the children of the change; every `w.*` element's Mount lets the presences deliver before it registers anything; and the layout observer asks for its pass once they have. So a `layoutId` twin entering in the same patch takes over from where its leaver was pinned, not where the patch pushed it.
