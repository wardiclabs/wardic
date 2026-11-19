---
"@wardic/foldkit": patch
---

A tree mounted by one patch starts top-down (#848): a `w.*` element now starts once its nearest `w.*` ancestor has, where it started at its own Mount, which Foldkit runs before the parent's. Variant children under a parent with `staggerChildren` mounted in the same patch started together, each reading a stagger slot set with itself alone registered; they now read it with every sibling known, and the storefront's product grid staggers on a client-side navigation and a Replay as it did on a hard load.
