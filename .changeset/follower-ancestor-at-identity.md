---
"@wardic/dom": patch
---

A `layoutId` twin's Follower now stays on its Lead when a Wardic element the Lead is inside starts moving or scaling after the shared-layout animation began, such as a `whileHover` scale, a drag, or a later `animate` change on that container. Before, the Follower drifted off by as much as the container moved. A transform that isn't Wardic's, such as CSS's own, still isn't followed during the animation.
