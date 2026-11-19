---
"@wardic/dom": patch
---

`PresenceController.snapshot(children)` (#840): a binding whose change reaches the presence after its framework's patch (Foldkit's) measures its children where they are before the patch, and a `popLayout` leaver of the next change is pinned at that box, not where the patch has pushed it. A binding that resolves a change before its framework applies it (Solid's) is as it was.
