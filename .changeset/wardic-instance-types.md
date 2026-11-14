---
"@wardic/solid": minor
---

The types of a Wardic instance (#516): `WardicInstance<F>`, a `w` whose elements take only the props of Features `F`, and `WardConfigOf<F>`, those props for a component that hands them on. A prop of a Feature the list lacks is typed `NeedsFeature<"name">`, so giving it is a type error that names the Feature; on Solid 2, so is listening for its event on a ward. `createWardic`, which makes one, follows. Each Feature carries its name as a type (`Feature<I, S, N>`), and `domAnimation` and `domMax` are typed as tuples of their Features. `WardicComponent<Tag, F>` and `W<F>`, and on Solid 2 `Ward<C, F>` and `WardicWrapped<P, F>`, take an instance's Features as a parameter whose default, every Feature, leaves them as they were.

On Solid 2, `ward()` and `w.ward()` reject a key no ward takes beside one it does, as they did alone: `ward({ animate: { opacity: 1 }, whilHover: { scale: 1.1 } })` compiled (#756).
