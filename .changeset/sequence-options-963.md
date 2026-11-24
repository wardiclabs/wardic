---
"@wardic/object": patch
"@wardic/three": patch
---

A sequence written inline in `animate` now has its options and its Segments type-checked (#963). Given options, TypeScript took the sequence for a list of Subjects, each Segment an array. It accepted whatever options fit an array's target (wrongly typed, misspelt, `{}`, a `transition`) and stopped checking the Segments. A sequence declared as an `ObjectSequence` or `ThreeSequence`, or one called without options, was checked.

```ts
wardic.animate([[mesh, { x: 1 }]], { duration: "slow" })
// 'duration' does not exist in type '{ readonly "an array isn't one Subject: a list of them, or a sequence, whose options are WardicSequenceOptions": never }'
```

`animate` reads an array as a list of Subjects, or a sequence, never as one Subject, and the types now agree. `ObjectTarget<T>` and `ThreeTarget<T>` for an array are a type nothing fits, and `AnimatableKey<T>` for one is `never`. Lists of Subjects type as before, a mixed list taking the keys its Subjects share.
