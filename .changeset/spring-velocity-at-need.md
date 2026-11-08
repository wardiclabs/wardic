---
"@wardic/core": patch
"@wardic/solid": patch
---

An element's spring animation stops copying its velocities every frame, and reads them only when a new animation, a handoff or an exit needs them. On 1,000 elements springing at once, a frame allocates about a third fewer bytes. `Machine.springValues` gives its Frame's keys by index too (`keys`, `positions`, `velocities`, typed `Frame.SpringValues`), and takes `records: "value"` to skip writing its velocity record. `Machine.toStream` emits a `springValues` Frame's records alone.
