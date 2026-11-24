---
"@wardic/object": patch
"@wardic/three": patch
---

`animate` types a Subject's optional keys and its numeric keys (#964): `{ a?: number }`, a `Partial<Record<string, number>>`, a key that may hold `undefined`, a typed array's elements and a number index. Each always ran; TypeScript rejected it.

```ts
const weights = new Float32Array(4)
wardic.animate(weights, { 0: 1, transition: { 0: { duration: 0.2 } } })
const sprite: { a?: number; b: number } = { a: 0, b: 0 }
wardic.animate(sprite, { a: 1, transitionEnd: { a: 0 } })
```

- **An optional key** takes its value without `undefined`, and its entry and its end as any key's. If the object lacks it when `animate` is called, `animate` throws, naming the key, as it always has. A key that only ever holds `undefined` still isn't one.
- **A numeric key** is checked as any key: `{ 0: "x" }` on a `Float32Array` is an error, and so is a misspelt key beside its index. An index past the end throws when called. `AnimatableKey<T>` gives it by name, `"0"`, or `` `${number}` `` for a number index, so its keys stay strings.
- **`@wardic/three`:** any other object, a typed array among them, as `@wardic/object`'s.
