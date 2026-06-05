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
