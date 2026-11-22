---
"@wardic/core": patch
"@wardic/dom": patch
---

`createBatch`'s `animate` calls run on core's new `@wardic/core/unstable/BatchCalls` (#882): an Environment's Batch, `@wardic/object`'s too, now takes its targets, transitions, stagger and sequence Segments by the same rules. Every Batch behaves as it did.
