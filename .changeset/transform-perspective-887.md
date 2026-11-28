---
"@wardic/dom": patch
---

`transformPerspective`, Motion's key for an element's own depth, is drawn on the DOM: a `perspective()` at the head of the element's `transform`, in px for a number (#887).

```tsx
<wardic.div style={{ transformPerspective: 600 }} whileHover={{ rotateY: 15 }} />
// transform: perspective(600px) rotateY(15deg)
```

- **Where it's drawn:** ahead of the rest of the transform, on a `layout` element too, and on a Batch's members.
- **At 0, its identity, there's no perspective.** A depth below 0, a spring's overshoot, is left out, since CSS would drop the whole `transform` with it.
- **It animates on a transform's spring,** `rotateY`'s, so a depth and a turn that leave together settle together. Reduced motion lands it at once.
- **A server's Appear animation waits for the JavaScript when the depth moves:** CSS blends a depth by its inverse, not as Wardic draws it. `appear="explain"` says so.
- **`scaleZ` is typed now,** with `transformPerspective`. #883 drew it, but `animate={{ scaleZ: 2 }}` didn't typecheck.
- **`perspective`,** the property that gives an element's children their depth, takes a bare number, drawn in px.
