---
"@wardic/core": patch
"@wardic/object": patch
"@wardic/three": patch
---

A transition's entry under one of an object's or a scene's own keys now types (#952). It always ran; TypeScript rejected it, so typed code fell back to `default`, a variable or a cast.

```ts
wardic.animate({ a: 0, b: 0 }, { a: 1, b: 1 }, { duration: 1, a: { duration: 0.1 } })
three.animate(mesh, { x: 2, color: "#00f", transition: { duration: 1, color: { duration: 0.2 } } })
```

- **`@wardic/object`:** `animate`'s options and a target's own `transition` take an entry under any of the Subject's keys, and a Batch call's under its keys.
- **`@wardic/three`:** the same for a scene's Subject, a uniforms object and a Batch. A colour's entry goes under its name (`color`), never its channels (`colorR`).
- **What no longer types:** an entry under a key the Subject hasn't, or under `layout`, which objects and scenes have no animations for. A key named like a transition field (`duration`, `type`) takes no entry, since that name is the field's.
- **`@wardic/core`** adds `Config.WardicTransitionFor<K>` and `Imperative.WardicAnimateOptionsFor<K>`, for an Environment whose keys are its Subject's. The DOM keeps `WardicTransition` and `WardicAnimateOptions`.
