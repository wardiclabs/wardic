---
"@wardic/foldkit": patch
---

Unmounting `w.*` elements costs less (#849): on the bench, a thousand `w.div`s unmount in 7.5 ms instead of 13.4, and mount in 27.7 instead of 29.6, with 7% less allocated. Each element's Mount forked a fiber to follow DevTools' view state and another to run its setup. Now the provider follows the view state once for every element, and the setup runs on the Mount's own fiber. Nothing an app sees changes: Messages, the release when an element is removed, DevTools replay and the Scene test names are as they were.
