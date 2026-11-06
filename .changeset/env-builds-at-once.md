---
"@wardic/solid": patch
---

A `WardicProvider` whose `env` waits as it builds, such as one with Effect's `DevTools.layer()` in it, fails its first element with an error naming the fix, where it failed with Effect's `AsyncFiberError` and, on Solid 2, halted the reactive system unexplained. A provider builds its `env` at once, so a Layer that waits goes in built: the observability guide's sample now builds the devtools before the app renders, in development alone.
