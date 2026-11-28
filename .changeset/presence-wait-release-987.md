---
"@wardic/solid": patch
---

Under `<AnimatePresence mode="wait">` on Solid 2, a leaving child with no `exit` no longer trips Solid's dev checks (#987). Before, it went at once, and the presence put the held child on the page by writing a signal inside the effect that reads it: `EFFECT_WRITES_OWN_SOURCE` and `EFFECT_RELAY_TEAR` were reported, and a strict dev setup failed on them.

- **A child released as the presence updates goes on the page a microtask later,** still before the next paint. One released as a leaver's exit animation ends goes on at once, as before.
