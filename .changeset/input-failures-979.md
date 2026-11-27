---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
"@wardic/three": patch
---

An app's code that throws in an input listener no longer keeps the listener's other readers and watches from the event (#979).

```tsx
const { scrollY } = createScroll({ container: () => box })
createEffect(() => {
  if (scrollY() > 100) throw new Error("…")
}) // on Solid 1
// before: the throw came out of the box's scroll listener at every scroll, and a second createScroll of the box stopped following it
// now: the second follows every scroll, and "wardic.scroll: its dependent failed" is logged once until a scroll sets it cleanly
```

- **A scroll reader whose dependent throws** (an app's Atom, or a Solid 1 effect, over `createScroll`'s values): the container's other readers hear every scroll. Logged once as `wardic.scroll: its dependent failed`, until a clean scroll.
- **Foldkit's `Wardic.pointer`:** a value whose dependent throws no longer leaves the rest of that event's values unset. Logged once as `wardic.pointer: its dependent failed`, with its key.
- **A core watch with no `onDefect`** (`InputFeed.watch`, `Recognizer.watchHover` or `watchPress`, `DragRecognizer.watchDrag`, called directly): a handler's throw no longer goes up the event's dispatch, where it kept the target's other watches, the ancestors on its path and the later members from the event. It's logged once a run of throws as `wardic.input: a watch's handler failed`, on the context the watch started in, and the watch goes on. `InputFeed.switched` with none logs on Effect's default runtime.
- **A three scene's `createBatch`:** a `whileHover` or `whileTap` function that throws, or gives a key the Batch hasn't, is logged as `createBatch: a gesture failed`, and its member stays where it is. Before, it was dropped silently, and the next `animate` change called it again and halted Solid. A gesture's function is now read as its gesture starts, as on the DOM.
- **`createBatch`'s gesture events,** on both Solid bindings and in a three scene: a hover's or a press's start is told even when its gesture's function throws, so its end is never told alone.
