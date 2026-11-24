---
"@wardic/solid": minor
---

A Stage ward's `read` takes its Subject's keys at their types (#939). `StageWard` carries its Subject, and `StageReads`, a generic interface an Environment adds to by declaration merging, says what each of the Subject's keys reads as. With `@wardic/three/solid`, these are each an `Accessor<number>`:
- `ward(kiln, {}).read("heat")`, a number on a `Group` of your own;
- `ward(light, {}).read("intensity")`;
- `ward(mesh, {}).read("roughness")`.

`undefined` is among it only while an accessor gives no Subject. A key the ward hasn't moved reads what its Subject holds, where it read `undefined` until something animated it, on the server too. `StageRead`, `StageReadKey`, `StageValueOf` and `StageSubjectOf` are its types.
