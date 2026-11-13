---
"@wardic/dom": minor
---

`@wardic/dom/TimelineValue` runs a scroll-derived Live value on the browser's own scroll timeline, so it moves with a scroll the browser runs off the main thread instead of a frame or more behind it. `TimelineValue.make` takes core's `LiveValue.scrollDerivationOf` and an element's key, and gives `None` wherever a timeline wouldn't draw exactly what the gate draws. The Flush gate's new `timeline(id, key, value)` runs it while the key shows its Live value: it goes on writing the key inline, starts the animation over it at the flush that commits the element, and cancels it at the flush that hands the key to anything else, so no frame shows neither.
