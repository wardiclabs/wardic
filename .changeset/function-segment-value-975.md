---
"@wardic/core": patch
---

A function Segment takes a value with no options (#975), as its docs said and as Motion's motion value Segments take one.

```ts
animate([[(v: number) => draw(v), 5]])
// before: the 5 was dropped, and the callback was told 0 to 1
// now: 0 to 5, on the default transition
animate([[(v: number) => draw(v), [0, 1, 0]]])
// before: TypeError: self.startsWith is not a function
// now: through its stops
```

- **Value or options:** a two-part function Segment's second part is its value when it's a number, a string or a list of stops, and its options otherwise, as before.
- **Types:** `[callback, value, options?]`, a number's or a string's, with its options optional.
