---
"@wardic/core": patch
"@wardic/dom": patch
"@wardic/solid": patch
---

An app's callback that throws each time it's called is now logged once, not at every call (#979). Its first throw is logged, and its next call that returns ends the run, so a callback that throws every frame or every move logs one line. A callback Wardic calls once, such as `onSettled` or `usePresence`'s `safeToRemove`, is still logged each time.

```tsx
<wardic.div drag onDrag={() => track(position())} onHoverStart={() => hint.show()} />
// before: an onHoverStart that threw was logged at every hover, "wardic.gesture: onHoverStart failed"
// now: logged at the first, and again only after a hover whose onHoverStart returned
```

- **Logged once a run:**
  - Frame effects: `createFrameEffect`'s apply, and `afterWrites`' effects on a Stage;
  - Solid 1's `onAnimationStart` and `onAnimationComplete`, on an element and on a `createBatch`;
  - every gesture callback: `onHoverStart`, `onTap`, `onPanStart` and the others, as `onDrag` and `onPan` already were;
  - a gesture handler's failure, on Solid, Foldkit and three: a watch's own throw at each move, a `transformPagePoint`'s among them;
  - a drag's failing response, its `onMeasureDragConstraints` and its release's `modifyTarget`;
  - `onExitComplete`, and the layout callbacks (`onLayoutAnimationStart`, `onLayoutAnimationComplete`, a layout node's `onDragTransitionEnd`, `onBeforeLayoutMeasure` and `onLayoutMeasure`);
  - a Batch's exit function, once for all of a change's leavers.

  Each callback, on each element, has its own run. The messages are unchanged.
- **A hover's or a press's start that throws on three's Stage,** and a Reorder item's `onHoldEnd` or `onReorderEnd`, are still logged once a gesture: the calls between them return.
- **A Stage's sensors** (`createHover(mesh)`, `createDrag(mesh)` and the rest) report on the provider's runtime, so the app's logger and `ErrorReporter`s hear them. Before, they went to Effect's default logger.
- **A `Reorder.BatchGroup` item whose `onHoldEnd` or `onReorderEnd` throws** is still let go to its place, and its next drag moves it. Before, it stayed where it was dropped, and couldn't be dragged again.
- **A layout callback's getter that throws,** such as a `createWard` accessor config's, is that element's own failure. Before, it kept the elements after it in the same frame from hearing their `onLayoutAnimationStart`.
