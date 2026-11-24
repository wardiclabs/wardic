---
"@wardic/object": patch
"@wardic/three": patch
---

A sequence written inline in `animate` has its options and its Segments type-checked when the call gives options (#963). TypeScript accepted any options there, and stopped checking the Segments too, though a sequence declared as an `ObjectSequence` or `ThreeSequence`, or one called without options, was checked.

```ts
wardic.animate([[mesh, { x: 1 }]], { duration: "slow" })   // now a type error: `duration` is a number
```

The error is reported against `animate`'s Subject signature, the last one, so it reads `'duration' does not exist in type …`. An array no longer has animatable keys (`AnimatableKey<T>` is `never` for one), since `animate` reads a list as many Subjects, never one.
