---
"@wardic/solid": patch
---

A `Reorder.BatchGroup` under `box-sizing: border-box`, as a CSS reset makes it, holds its padding and border in the size it writes on itself, read as it mounts and as it's resized: a padded group's items stayed inside it no more. On Solid 1, the first change of the style a group gives its items removes the keys it drops, as every change after it did.
