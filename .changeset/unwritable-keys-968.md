---
"@wardic/object": patch
"@wardic/three": patch
---

`animate` refuses a key it can't write, naming it, as it refuses a key the object lacks (#968). Before, each frame's write threw, and the error was logged once a frame. The flush stopped there, so every write after it that frame was lost, a separate animation's among them.

```ts
wardic.animate(Object.freeze({ x: 0 }), { x: 1 })
// wardic.animate: the object's "x" can't be written (it's read-only, or a getter with no setter), so Wardic can't animate it. Give a key it can write.
```

- **What can't be written:** a read-only property (a frozen object's, one defined without `writable`, three's `id`), or a getter with no setter (a typed array's `length`, a class's). The property can be the object's own or inherited. A getter with a setter, and a sealed object's key, animate as any key.
- **When:** at the call for `animate` and a sequence, a later Segment's included. For a ward, when its leg starts, as for a key it lacks.
- **`@wardic/three`** checks every place a key is written: a mesh, its material, a uniform. A frozen uniform is refused too.
- **The types** leave out the keys that can never be written: a typed array's `length`, `byteLength`, `byteOffset` and `BYTES_PER_ELEMENT`, and a scene object's or a material's `id`. `readonly` isn't read as unwritable otherwise, since a `Readonly<…>` object is writable. A plain object's own `id` and `length` stay keys.
