# Declared layout change

A Measure pass takes each node's "before" from its retained Measurement, the box its last pass read (ADR-0005, ADR-0018). #4 adds an opt-in boundary for changes that model misses: `animateLayout(fn)`, a **Declared layout change**.
1. The call measures every Projection node afresh.
2. Then it runs `fn`.
3. The Measure pass at the end of the task animates whatever moved, from those Measurements.

The engine owns it (`ProjectionSystem.animateLayout`), and Solid hands it to an app through `useAnimateLayout()`.

## Why

- **A change no trigger sees doesn't animate.** A keyed `<For>` reorder moves DOM nodes without resizing any, and a plain element's class can push nodes without resizing them. Neither registers a node, resizes one, or changes a `layoutDependency`, so no pass runs and the nodes jump.
- **A change between two Measurements leaves them stale.** After such a jump each node's Measurement still holds its old box. The next pass, for any reason, animates that old jump as if it had just happened.
- **ADR-0005 kept this for an opt-in.** It rejected a synchronous pre-mutation snapshot as the default, since Solid has no commit phase to hang it on. The research behind it (`docs/research/motion-layout-orchestration.md`, *Option B* and §8.2) named the explicit boundary as the only way to get a pre-change "before" exactly, and as additive to the retained model.
- **Motion ships it for callers without React.** Its `animateLayout(scope?, update, options?)` (`packages/motion-dom/src/layout/LayoutAnimationBuilder.ts` @ `16c6122`, motion PRs #3747 and #3748) works like this:
  1. Calls made in one tick queue.
  2. A microtask measures every node.
  3. It runs every queued update.
  4. It reconciles additions before removals, then commits.

  Its fixture `parallel-calls-intersecting.html` is the falsifying case. Call A grows `#grow`, which pushes call B's `#child`; at 50% of a linear tween `#child` must read top 150, left 50. That's from where it was seen, not from where A pushed it.

## Decisions (grilled 2026-10-15, all A)

1. **Fresh Measurements, then a pass** (Q1). The call measures every node before `fn` runs, and the end-of-task pass animates from those Measurements instead of the retained ones.
   - Rejected:
     - just a trigger (run `fn`, then `notify`), which inherits a stale Measurement and adds little to `layoutDependency`;
     - both, behind an option.
2. **Synchronous, with one set of Measurements per task** (Q2).
   - **How it runs:** the first call in a task measures, then runs `fn` at once. Later calls in the same task share those Measurements, so a node one call's change pushes animates from before the first change, which passes Motion's intersecting fixture.
   - **What `fn` gets:** its change is in the DOM when it returns (Solid 1.9 applies a write outside a `batch` at once), its error throws to the caller, and it runs under the caller's owner.
   - **The boundary:** anything else that changes layout later in that task animates from the Measurements too, since the boundary means "from this call on".
   - Rejected: Motion's deferral, where the callback runs in a microtask after the read. The call would return before its change, the callback's errors would surface away from the caller with no owner, and its read would have to be ordered before a pass already queued.
3. **The whole tree, no scope** (Q3). Every pass already measures every node and animates any that moved, so a node the change pushes animates wherever it is.
   - Rejected:
     - a scope element, which gives nodes outside it the stale origin #4 fixes;
     - a scope that also limits what animates, which is a new rule with no case for it.
4. **A pass already due runs at the call** (Q4).
   - **With a trigger earlier in the task:** that pass runs at the call. What triggered it animates as it would have, from the retained Measurements, and its reads are the call's Measurements. Its queued microtask then runs the end-of-task pass.
   - **With nothing pending:** the call's read is a slot-only update of every node, the **Resize block**'s update (ADR-0018, *Amendment (#39)*). It starts nothing, and a running animation keeps its delta.
   - **What the read leaves alone:** it isn't a pass a **Reorder group** waits on. No `layoutVersion` rises and no pass-end listener runs, because the layout it reads is from before the change: an `onReorder` that declares its write must not release the reorder's guard, or reveal a keyboard step's old place.
   - A change with no trigger before the call is absorbed: it jumps, as it does today.
   - Rejected:
     - always a plain read, under which a triggered change earlier in the task jumps once a call follows it;
     - keeping the retained Measurements of the nodes a pending trigger names, since `notify` names none.
5. **An engine method and a Solid hook** (Q5). `@wardic/dom`'s `ProjectionSystem.animateLayout(fn)` does the work, so a later binding reuses it. `@wardic/solid`'s `useAnimateLayout()` returns the provider's, called in a component body and used from a handler.
   - Rejected:
     - a global `animateLayout` over a new registry of providers, when gates, runtimes and nodes are all per provider;
     - the Solid binding alone.
6. **It returns `fn`'s result** (Q6). Only the synchronous part is inside the boundary. A promise `fn` returns isn't awaited, and the call logs a warning (`wardic.projection: animateLayout's callback returned a promise; only its synchronous part animates`). Async data wraps its own write when it arrives.
   - Rejected: Motion's thenable of the started animations, with async callbacks awaited, which holds Measurements across tasks.
   - A way to wait for a call's animations is #191, with Motion's `onLayoutAnimationStart` / `onLayoutAnimationComplete`.
7. **The glossary's term is Declared layout change** (Q7). The read at the call is a **Measurement**, never a "snapshot": the glossary reserves **Snapshot** for a motion value's cached Frame.
8. **Registered nodes only** (Q8). It measures and animates the elements a binding registered (`layout`, `layoutId`). Motion's path for plain elements (`data-layout` / `data-layout-id` discovery, nodes made and dropped per call, a removed lead put back to crossfade out) is #192.
9. **The Resize block wins** (Q9). A call in the 250 ms after a width change runs `fn` and takes no Measurements, and the pass that follows starts nothing, as every pass in the block does. Motion's `animateLayout` commits through `didUpdate`, which drops an update blocked by a resize.
   - Rejected: a declared change ending the block, which would make the block depend on how a pass was triggered.
10. **Checked at every tier** (Q10):
    - engine tests, with Motion's fixture ported;
    - Solid browser and server tests;
    - the lab's scenario 17;
    - mutations;
    - a hand pass on desktop and phone.
11. **The name stays `animateLayout`** (Q11). A magic-themed vocabulary for the whole API is one naming pass, #193. *ADR-0042 keeps it: the pass themed nouns, not verbs.*
12. **This ADR** (Q12), with notes in ADR-0005, ADR-0009 and ADR-0018.

Defaults stated, not asked:
- **A drag:** a dragged node and its subtree take their slot-only update in either pass, as in any pass (**Drag block**).
- **Reduced motion:** applies as in any pass.
- **On the server:** the hook's function just runs `fn`.
- **From inside a pass's own flush** (an effect): the call takes no Measurements. Its change repeats the pass, which animates it from the reads the round just made.
- **A callback that throws:** what it changed before throwing still animates.
- **A nested call:** runs inside the outer one's boundary.

## Consequences

- **New public API:**
  - `ProjectionSystem.animateLayout`;
  - `@wardic/solid`'s `useAnimateLayout` and its `AnimateLayout` type.

  A hand-built `ProjectionSystem` adds the method.
- **Cost:** a call reads every node's box once more than the task would have, at the call. The `wardic.projection.declared` span traces that read.
- **What it can't see:** a change after an `await` in the callback, and anything that happens in a later task.
- *Note (#191, 2026-10-15):* A call can now ask to be told when its change has settled: `animateLayout(fn, { onSettled })`. That's once every layout animation its end-of-task pass started has ended, however each ended, or at that pass's end if it started none. Calls in one task settle together (ADR-0039).
- **The lab's scenario 17 shows it next to what it fixes:**
  - **Shuffle** declares a keyed reorder: clean.
  - **Shuffle, untriggered** snaps.
  - **Shuffle, triggered**, after **Grow panel** (a plain panel growing with no trigger), reads wrong-origin from a stale Measurement.
    *Note (#261, 2026-10-21):* it still does after the **Page-size refresh** (ADR-0018, *Amendment (#261)*). The panel grows inside the stage's fixed height, so the page's size doesn't change.
  - **Two calls** is Motion's intersecting pair: clean.
- **A limit of the lab's classifier, not of this:** a stale place along the item's own line of travel reads clean, so only the panel's perpendicular move shows the stale origin every time.

## Pinned by

- **dom:**
  - `test/projection-declared.browser.test.ts` DL1–DL8:
    - the stale Measurement, beside a plain trigger's stale start;
    - Motion's intersecting fixture with its 50% boxes;
    - a pass already due running at the call;
    - the result, an error and a promise's warning;
    - a running animation restarted or carried on;
    - no `layoutVersion` or pass end at the call;
    - a call from inside a pass's flush;
    - a later task's own Measurements.
  - `test/projection-resize-block.browser.test.ts` RB10 (the Resize block wins).
- **Solid:**
  - `test/animate-layout.browser.test.tsx` AL1–AL3: a keyed `<For>` reorder animating declared and jumping plain, the synchronous change and result, the error outside a provider;
  - `test/server.ssr.test.tsx` SV17: on the server, the call runs its callback.
- **Lab:** scenario 17, by hand.

## Amendment (#618, 2026-11-05): a write Solid 2 holds

Found in the review of 2026-11-05 (decision 13), then probed. Solid 2 holds a write made inside an `action`, or in the frame of a write that starts async work, until what it waits for settles. A keyed `<For>` reordered through Solid 2's `animateLayout` that way jumped: the call's end-of-task pass ran before the write moved the DOM, and nothing measured it once it did. The promise resolved at that first pass, before the move.

- **Decided** (A): Solid 2's `animateLayout` also asks for a pass once what the call is part of has settled (Solid's `onSettled`), and its promise waits for that pass's animations, not the first one's.
  - **Nothing held:** Solid settles before the end-of-task pass, so the second request joins the call's own pass. One pass, as before.
  - **A write held:** the end-of-task pass sees nothing move. The pass after the settle animates the write from the boxes the last pass kept.
  - The request is unowned, so the caller's owner being disposed first can't drop it, and the promise with it.
- **The engine:** `animateLayout`'s options take `from`. `"call"`, the default, is unchanged. `"lastPass"` takes no Measurements at the call: its pass compares with the boxes the last pass kept, for a change a framework applied after the call.
- **Solid 1** is unchanged. Its `startTransition` holds writes too, and could use `from: "lastPass"` the same way if a case shows up.
- **What it can't see** now leaves out Solid 2's held writes. A change after an `await` in the callback still isn't seen.
- **Pinned by:**
  - **dom:** `test/projection-declared.browser.test.ts`:
    - DL9: a change made before a `lastPass` call animates from the last pass's boxes and jumps from the call's; its onSettled waits for the animation;
    - DL10: beside a plain call, it joins that call's pass.
  - **Solid 2:** `test/v2/animate-layout-held.browser.test.tsx`:
    - AH-1 and AH-2: plain and in a sync action, as before;
    - AH-3 and AH-4: in an action that waits, and beside an async write, now animate;
    - AH-5 and AH-6: their promises resolve once the item has landed.

    AH-3 to AH-6 fail on `main`.
