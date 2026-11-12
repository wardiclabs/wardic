---
"@wardic/core": minor
---

A Batch's change can start its members partway: `Batch.retarget`'s `startAt` gives how far each member's change has run, read at its first step, which draws it there at the speed it has there (a spring by its closed form, a tween by its curve), as an Appear animation taken over has it. A step of 0 s no longer lands every spring of a member whose keys run transitions of their own on its target.
