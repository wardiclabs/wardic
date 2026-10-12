# Variant orchestration: name propagation, snapshot-order stagger, binding-composed sequencing

Variant orchestration is a binding concern built on a small pure core surface. Through the tree, the binding propagates the current **variant name** (not resolved values) plus the inherited transition/stagger config and a `registerChild` handle; each child holds its own `variants` map and resolves the inherited name locally (a child's `"open"` is independent of its siblings'). A target resolves by priority: local `animate` > parent-context variant > `initial`. The only core piece involved is the existing pure `stagger(amount, opts): (index, total) => delaySeconds` — the binding supplies `index`/`total`.

**Stagger order is snapshotted at transition-trigger time.** When a parent variant changes, the Provider snapshots the current child order (source/positional order at that instant), assigns each child an `index`/`total` for *that* transition, and each child computes its delay from the inherited stagger fn. A reorder, mount, or unmount *mid-transition* does not reshuffle in-flight delays — each child is already animating with its assigned delay — and the next variant change recomputes from the new order. `staggerDirection` reverses the index, `delayChildren` adds a fixed offset, `from` selects the origin (core stagger option).

**`when` sequencing is composed in the binding from existing combinators.** `beforeChildren` runs the parent stream, then on its `onSettle` starts the staggered children `group`; `afterChildren` runs the children `group`, then on all-settled starts the parent; the default is concurrent with stagger/delay offsets. No new core combinator is introduced.

## Considered Options

- **Propagate resolved values instead of the variant name.** Rejected: siblings define different values for the same named state, so resolution must be local to each child; pushing values down would force the parent to know every child's value map.
- **Continuously reactive positional stagger index** (index always reflects current visual position; mid-transition reorders re-derive delays live). Rejected: reordering during a transition causes in-flight delay jumps/restarts (jank) and is the most complex against keyed `<For>` identity. Snapshot-at-trigger gives visually-correct order at the moment that matters without continuous re-indexing.
- **Mount-order indices, retained** (the original plan's literal wording). Rejected: after reorders the stagger no longer follows visual order, and it never actually defined the mid-transition case — the open question this ADR closes.
- **A core `sequence`/`andThen` combinator, or a core `orchestrate({parent, children, when})` primitive.** Rejected: `when`'s parent-then-staggered-children shape isn't a plain linear sequence (so a `sequence` combinator only partially fits), and a full orchestration primitive bakes the component-tree timing model into core — the "fat core" trap ADR-0004 rejected. `onSettle` + `group` + `delay` already express it.

## Consequences

- Core gains nothing for variant orchestration beyond the `stagger` util it already ships; the boundary holds once more (binding owns tree + lifecycle, core owns the delay math).
- Stagger is a per-transition snapshot, not a live binding: predictable under churn, and the implementation never has to reconcile in-flight delays with a changing child set.
- A child that inherits a variant name it doesn't define simply has nothing to animate for that transition (no-op), which is also how a child opts into inheriting only some states.
- `<AnimatePresence>` exit (binding-only, on `onSettle`) composes with this: an exiting child can inherit the parent's `exit` variant by the same name-propagation path; exit stagger is the same snapshot mechanism with a reversed/own ordering.
- A future `@wardic/react` binding reuses the same model over React context + its own child-registration; only the registration plumbing differs, not the stagger math or the sequencing composition.

## Amendment (#47, 2026-10-02): below the base, each key falls back to its Base value

The priority above resolves the base layer as a whole: local `animate`, else the parent's variant, else `initial`. A key that no layer sets any more, including one the base layer drops, then returns to the key's `initial` value, else its `style` value, else the element's Own value (ADR-0022). #50's inherited `initial` will join at the `initial` link.

## Amendment (#77, 2026-10-09): a staggered tween with a `repeat` waits its stagger once

- **The binding folds a child's stagger into its transition's `delay`.** `animate` held that `delay` again before every segment of a `repeat` / `yoyo` run, so a staggered child's repeating tween waited its stagger again before each repeat.
- **Since #77, `delay` holds once,** before the first segment (ADR-0027, *Amendment (#77)*). So the stagger offsets each child's start once, as a per-child `delay` does in Motion.
- **A spring transition has no segments,** so it's unchanged.

## Amendment (#50, 2026-10-12): every Wardic element provides, and only a Variant child joins

#50 found that variant orchestration only ran through `useWardic`'s explicit `<ward.Provider>`: a `wardic.ul` passed nothing to its `wardic.li`s, so the most common Motion pattern, a staggered list entrance, didn't happen, and no child started from its parent's `initial`. Even under `ward.Provider`, every `useWardic` below it registered, `variants` or not. The grill (2026-10-12) took Motion's rule (`.reference/motion` at `16c6122`: `use-visual-state.ts:77-85`, `MotionContext/utils.ts`, `VisualElement.ts:461` and `:787-792`).

1. **Every Wardic element hands its children a variant context:** `wardic.*`, `wardic.create(Component)` and `<Reorder.Item>`, and `useWardic` through `ward.Provider` (a hook can't wrap its children). The directives read the context but provide none, since they render no children. An element renders the Provider only when it changes what its children read, that is when it has variants of its own or sets `inherit={false}` (`changesContext`). Any other hands them its parent's context as it is, so it renders none. That's decided once, at setup, from the same props on a server and on the client (ADR-0021, *Amendment (#50)*).
2. **Only a Variant child joins** (CONTEXT.md): an element with `variants` that names neither its own `initial` nor `animate`, and doesn't set `inherit={false}`.
   - It joins its nearest ancestor with variants of its own (`variants`, or a named `initial` or `animate`): it inherits that ancestor's names and default transition, takes a stagger slot among its variant children, and counts for its `when`.
   - Any other element passes its parent's context through untouched, so a plain `wardic.*` element between a list and its items doesn't break the chain. An element without `variants` inherits nothing and takes no stagger slot, where under `ward.Provider` it used to register.
   - Membership is decided once, at setup, as `initial` is read. The names stay reactive.
3. **The context carries the `initial` name too, read once.** A Variant child with no `initial` of its own resolves its ancestor's `initial` name against its own `variants`: its Starting style, its server markup and its spring's start (the Amendment (#47)'s `initial` link). Only names pass down: a values map hands down nothing, since it can't be resolved against a child's `variants`. An element that names its own variants hands down its own names; any other passes its parent's through.
4. **`inherit={false}`** (Motion's `inherit`): the element inherits no names, joins nothing, and hands its children no names from above it. It still provides its own, if it has any.
5. **A non-variant element no longer inherits its parent's default transition.** Before, any `useWardic` under `ward.Provider` took the parent's `transition` when it had none; now only a Variant child does, with the names.
6. **The registry costs the same per child at any size:** a `Set` in mount order with a count of the unsettled children, so a child's mount, unmount or settle never copies the registry or rescans it (it used to, through a signal of the whole array).

Rejected:
- **Provide automatically, but keep the old membership** (every Wardic element under a parent registers): an icon inside a list item would take a stagger slot and hold up `afterChildren`.
- **Keep `ward.Provider` explicit and document it:** the list pattern keeps not working.
- **Inherit `animate` only, or the `initial` name on the client only:** no entrance, or a snap at hydration (ADR-0021).

The server side is ADR-0021's *Amendment (#50)*.

Measured on the final code (the bench server, `wardic-quiet`, Chromium 147 headless; `.tmp/50-mount/` and `.tmp/50-ssr/`, not committed):

- **A client mount of 1,000 elements in one task**, main, an A/A copy of main, and this branch, 7–11 paired reps, with a GC before each mount (median [p25–p75]):

  | Workload | main | here | here / main | A/A |
  |---|---|---|---|---|
  | `flat`: `wardic.div`s, no variants | 146.7 / 128.0 ms | 143.6 / 126.1 | −2.1% [−2.6, −0.5] / −1.6% [−1.9, −1.4] | +0.2% / −0.1% |
  | `own`: `wardic.li`s naming their own variants | 147.7 / 128.3 | 153.3 / 130.9 | +4.3% [+1.6, +4.5] / +2.5% [+1.4, +3.5] | −1.4% / −0.5% |
  | `list`: a `wardic.ul`'s 1,000 Variant children | 124.1 / 108.1 | 154.5 / 137.7 | +25.2% / +27.3% | −3.1% / −0.3% |

  (cold / warm in each cell)

  - A plain element mounts slightly cheaper: it no longer builds a registry and its memos for children that never come.
  - An element with variants of its own pays about 3–6 µs for its Provider and its orchestration.
  - `list` against main isn't like for like: on main the `li`s never animate (#50's bug). On this branch `list` against `own` is what joining costs: 1–7 µs per child.
  - Without the forced GC, `flat`'s warm mounts were bimodal on this branch (a median of +9.5% [−1.0, +10.9], with the same work): a collection landed in some of them. With the GC moved out of the timed task, the branch is the cheaper one.
- **A server render of 1,000 elements**, 9 alternating pairs: `flat` +3.3% [+2.5, +4.8] (3.11 → 3.25 ms); the variant list +76% (2.84 → 5.04 ms, about 2.2 µs per `li`), which now renders its inherited Starting style and its own Provider. A Provider on every element, before it was made conditional, cost `flat` +37%.

Pinned by `variant-inheritance.ssr.test.tsx` (VI1–VI10), `variant-inheritance.browser.test.tsx` (VB1–VB5) and the hydrate project's F18. Without the element's Provider, VI1, VI3, VI9, VB1, VB4 and VB5 fail; with every element joining, VB2 (a stagger slot), VB3 and VI5 (`inherit={false}`) fail.

Gates: `bun run typecheck` (and the layout lab's), `bun run lint`, `bun run test` (67 files, 723 tests) and `bun run test:browser` (66 files, 659 tests; no "optimized dependencies changed" in the log).
