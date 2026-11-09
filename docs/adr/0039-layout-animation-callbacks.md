# Layout animation callbacks

An app can now hear about layout animations:
- `onLayoutAnimationStart` and `onLayoutAnimationComplete` on any layout element, Motion's two documented callbacks;
- `animateLayout(fn, { onSettled })`, called once a **Declared layout change** has settled (#191).

The engine tracks each layout animation (its *flight*) and calls them back after the frame is painted. The bindings pass the props.

## Why

- **Motion has the callbacks.** `onLayoutAnimationStart` and `onLayoutAnimationComplete` are public props (`packages/motion-dom/src/node/types.ts:932-939` @ `16c6122`). Its projection node hands them to the layout animation as `onPlay` and `onComplete` (`create-projection-node.ts:520-564`).
- **#4 left a gap.** `animateLayout` returns its callback's result (ADR-0038, decision 6), where Motion's resolves with the started animations. So an app had no way to act once a declared change's animations were done, such as re-enabling a Shuffle button.

## Decisions (grilled 2026-10-15, all A)

1. **Motion's two callbacks, and a wait on `animateLayout`** (Q1). Motion's `onLayoutMeasure` and `onBeforeLayoutMeasure` stay out. Nothing in Wardic needs them: `Reorder` reads `layoutVersion` and `layoutBox`, and they're Motion's only internal user. Publishing engine boxes would mean deciding which frame a box is in, and when one counts as measured.
   - Rejected:
     - all four, which brings the frame question for no known use;
     - the two props without the wait, since the wait needs the same tracking.
2. **Start fires at the frame where the flight takes its first step** (Q2). That's Motion's `onPlay` moment: Motion creates the animation in the next frame's update step after the measure, before any `delay` elapses.
   - **When it runs:** after that tick's flush, from the engine's own `afterTick` hook. The Frame loop calls its hooks in the order they were added, and the provider adds its gate's first, so the frame is in the DOM: the callback sees the first step painted.
   - **How often:** a restart fires again. Restarts within one task are one start, because each (re)start makes a fresh flight and only a flight that steps reports.
   - **A delay** doesn't defer it: the flight has started and holds.
   - Rejected: firing at the seed, in the Measure pass. That's up to a frame early, runs app code inside the pass's flush (which repeats rounds on a trigger), and fires two starts for two seeds in one task.
3. **Complete fires only for a flight that lands on its own** (Q3), at the frame it lands.
   - **A Release offset still running** doesn't hold it back: the offset springs on top of the layout animation and isn't one.
   - **No complete** for a flight a restart interrupted (the restart starts again), one a window resize finished early, or one an unmount cut off. Motion stops those (`finishAnimation` → `stop()` fires `onStop`, not `onComplete`). So a start isn't always followed by a complete. `onSettled` reports a change's end however it went.
   - Rejected:
     - a complete for every flight's end, which diverges from Motion and makes "complete" mean "stopped";
     - a new stop callback, which Motion doesn't have.
4. **The callbacks follow Wardic's flights** (Q4).
   - **Reduced motion:** the flight starts landed, so both fire in its first frame, as Motion's instant transition does.
   - **A blocked pass** (a dragged subtree's, a Resize block) fires nothing, as Motion's blocked update doesn't.
   - **Three divergences from Motion,** where Wardic starts no flight and Motion starts an animation:
     - a `layoutRoot`'s snap (Motion's is instant: both at once);
     - a **Layout mode** that leaves nothing to move, such as `layout="size"` on a pure move (Motion's runs its full length);
     - a node moved only by its parent (Motion's `hasOnlyRelativeTargetChanged`).

     Wardic fires nothing for these: nothing animated.
   - Rejected: synthesizing callbacks for moves Wardic doesn't animate.
5. **In a handover only the new Lead's callbacks fire** (Q5). A **Follower** has no flight of its own; it's held on its Lead. A Lead relegated mid-flight keeps stepping its flight, which the engine still marks (so an `onSettled` waiting on it ends), but its callbacks don't fire. That's Motion's: a follower shares its lead's animation, and a relegated one's is stopped.
   - Rejected: both twins' callbacks.
6. **`onSettled` waits for every flight the call's pass started to end, however each ended** (Q6). That means landed, cut short by a width change or an unmount, or restarted by a later pass. A pass that started none (nothing moved, a Resize block) settles at its end. It never hangs, and it's about this change only.
   - Rejected:
     - waiting for every element to be at rest, which a stream of changes keeps unbounded;
     - waiting for the engine to be idle, which an unrelated animation holds.
7. **An option on the call: `animateLayout(fn, { onSettled })`** (Q7). The return stays `fn`'s result. A promise is one wrap away: `new Promise((r) => animateLayout(fn, { onSettled: r }))`.
   - Rejected:
     - returning `{ result, settled }`, which undoes ADR-0038's decision 6;
     - a second function, `animateLayoutAsync`.
8. **The engine tracks flights, and the bindings pass accessors** (Q8).
   - **The engine:** `RegisterNodeOptions` gains both callbacks as accessors, read when they fire, like `transition`. Each flight carries `started` and `landed` marks, noted after its step. The end-of-task pass takes its task's `onSettled` callbacks with the flights it started. Calls in one task share that pass, so they settle together.
   - **Solid:** every surface takes the two props: `wardic.*`, `useWardic`, `use:ward`, and so `Reorder.Item`.
   - A callback that throws is reported (`wardic.projection: onLayoutAnimationStart failed`, and so on), and the frame goes on.
   - Rejected: raw flight events from the engine, with the callbacks and the wait in Solid.
9. **Checked at every tier, and in the lab** (Q9).
10. **This ADR** (Q10).

Defaults stated, not asked:
- the callbacks take no arguments (Motion's);
- on the server the props are inert, and `onSettled` is called once the callback has run (nothing to animate);
- the names wait for the naming pass (#193);
- disposing the provider calls nothing back.

## Consequences

- **New public API:**
  - the props `onLayoutAnimationStart` / `onLayoutAnimationComplete`;
  - `AnimateLayoutOptions` and its `onSettled`;
  - `RegisterNodeOptions`' two accessors.
- **The engine adds an `afterTick` hook,** which per tick costs two empty-array reads when nothing is pending. The coordinator's step notes each flight with two statement `if`s and no allocation.
- **A `NodeState` built for a leaving Follower** gets empty callbacks.
- **The lab's scenario 17** shows a `callbacks` line under its buttons: each run's starts and completes, and a declared run's settling, judged on as many completes as starts and the settling after the last complete. Shuffle and Two calls wait for their change to settle. Each settling is also noted on the lab's timeline panel; a saved log keeps runs only, so neither the line nor the note is in it.

## Pinned by

- **dom:**
  - `test/projection-callbacks.browser.test.ts` LC1–LC7:
    - start at the first step, not the seed, with two starts in a task as one;
    - complete at the landing, once, with a Release offset running, and not for an interrupted or unmounted flight;
    - reduced motion;
    - a `layoutRoot` and a dragged subtree, which fire nothing;
    - only the Lead in a handover;
    - a throw reported;
    - `onSettled` after a landing, a restart, an unmount and a pass with nothing, two calls together, and a throw reported.
  - `test/projection-resize-block.browser.test.ts` RB11: a width change's finish fires no complete and settles.
- **Solid:**
  - `test/layout-callbacks.browser.test.tsx` LCS1–LCS4:
    - a `wardic.div`, whose start sees its first step painted;
    - `useWardic`;
    - `Reorder.Item`s;
    - `onSettled` through `useAnimateLayout`.
  - `test/server.ssr.test.tsx` SV18.
- **Lab:** scenario 17's `callbacks` line, by hand.

## Amendment (#673, 2026-11-09): a start taken by an after-tick pass

A Measure pass that runs after its frame's tick takes the first step of the nodes it seeded itself (ADR-0018, *Amendment (#673)*). So a flight can take its first step in a pass, not at a tick.
- **Its start fires at the end of that pass,** after the pass's step is applied, as decision 2 has it fire after the tick's flush: the frame is in the DOM, and the callback sees the first step.
- **Each flight still fires one start:** the next tick, which takes its second step, doesn't fire again.
- **A flight that step brings to rest** lands at the next tick, so its complete fires there (decision 3).

Pinned by `packages/dom/test/projection-after-tick.browser.test.ts` AT6: the start comes once, after the pass's two writes (the seed and the step), before the next tick's.
