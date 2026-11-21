---
"@wardic/foldkit": patch
---

`w.*` elements mount and unmount for less (#849). On the bench, a thousand `w.div`s mount in 23.0 ms instead of 27.5 and unmount in 5.4 instead of 7.4, with 5% less allocated. Three changes:

- An element's Mount no longer makes a queue for Messages it may never send.
- Its Stream is a single step.
- Once the provider is up, an element mounts without waiting on it.

Nothing an app sees changes: Messages, the release when an element is removed, DevTools replay and the Scene test names are as they were.
