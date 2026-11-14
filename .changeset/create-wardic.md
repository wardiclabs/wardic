---
"@wardic/solid": minor
---

`createWardic(features)` makes a Wardic instance (#516): a `w` whose elements, and on Solid 2 whose wards, bring those Features wherever they render, beside the Features their `WardicProvider` and any `LazyWardic` give, and take only their props. Give it Features, presets and lists of them, or a load, `() => import("./drag-feature").then((m) => m.drag)`, which starts the first time one of its elements mounts on the client, and takes effect as it arrives. With `layout`, it also returns `useAnimateLayout`, `createInstantLayoutTransition` and `createResetProjection`, which bring it. Its elements render under a `strict` provider.
