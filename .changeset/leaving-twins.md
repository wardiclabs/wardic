---
"@wardic/dom": patch
---

A `layoutId` element no longer flies back toward a twin that is leaving too. Going back and forth between two pages quickly, under `<AnimatePresence mode="popLayout">`, could make the previous item's photo, on the page that leaves, fly toward its twin on the page that had already gone. It now stays where it's drawn and fades out with its page: a twin hands over only to one that isn't leaving, as Motion's does.
