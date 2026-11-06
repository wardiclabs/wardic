/**
 * Motion's default layout and drag transitions, apart from the Projection system: a binding's layout
 * element code reads them on every page, and the engine, `projection.ts`, ships only where an app lays
 * out.
 */
// ADR-0009 *Amendment (#171)*, ADR-0016 *Amendment (#140)*; #548; ADR-0067, *Amendment (#548)*.
import type * as Machine from "@wardic/core/Machine"

/**
 * A layout animation's transition: a spring, its fields and its `delay`; or a tween, its `duration`,
 * `ease` and `delay`. A repeat means nothing for a flight that lands once. A tween with no `duration` or
 * `ease` takes the tween's own defaults, 0.3 s and linear (a binding fills Motion's `easeOut` first).
 */
// ADR-0009 *Amendment (#171)*; #360; ADR-0051.
export type LayoutTransition = ({ readonly type: "spring" } & Machine.SpringOptions) | ({ readonly type: "tween" } & Machine.TweenOptions)

/**
 * Motion's default layout transition (motion-dom 13.3.0, `defaultLayoutTransition`): a 0.45 s tween,
 * eased `cubic-bezier(0.4, 0, 0.1, 1)`, so a layout animation lands on time.
 */
// ADR-0009 *Amendment (#171)*.
export const DEFAULT_LAYOUT_TRANSITION: LayoutTransition = { type: "tween", duration: 0.45, ease: [0.4, 0, 0.1, 1] }

/**
 * A drag's release (Motion's `dragTransition`): the inertia a node's Release offset runs on, with both
 * edges at its slot, so it springs back there on the bounce. Times in seconds. Its edges are the slot's,
 * never its own.
 */
// ADR-0016, *Amendment (#140)*.
export type DragTransition = Omit<Machine.InertiaOptions, "min" | "max">

/**
 * Motion's drag transition (framer-motion 13.4.0, `VisualElementDragControls.startAnimation`), with its
 * default `dragElastic`: a 0.75 s time constant, power 0.8, the bounce 200 / 40, at rest within 1 px and
 * 10 px/s. A node's Release offset runs on it when it's given none.
 */
// ADR-0016, *Amendment (#140)*.
export const DEFAULT_DRAG_TRANSITION: DragTransition = {
  power: 0.8,
  timeConstant: 0.75,
  bounceStiffness: 200,
  bounceDamping: 40,
  restDelta: 1,
  restSpeed: 10,
}
