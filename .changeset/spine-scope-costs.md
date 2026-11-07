---
"@wardic/solid": patch
---

An element's spring legs write its values in place instead of copying them every frame, and a `createAnimate` scope keeps its animations in flight in a set instead of copying its list at every start and end. On 1,000 elements, all retargeted at once through `createAnimate`, starting them takes 26–52% less time, a frame 7–19% less, and a frame allocates 64% fewer bytes. Nothing an animation draws changes.
