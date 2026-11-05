/**
 * One Projection system's Measure-pass ends, for the Reorder controller (ADR-0020): the engine's Layer
 * provides it beside the engine, and `ReorderController.make` requires it. Not exported from
 * `@wardic/dom`, so there's no public push hook (ADR-0020 decision 2).
 *
 * @internal
 */
// #618 (decision 12): the controller found the engine's listeners in a WeakMap keyed by the engine
// object, so a wrapped or replaced ProjectionSystem in the context silently heard no pass end.
import * as Context from "effect/Context"

/** `onPassEnd(listener)` runs `listener` at the end of every Measure pass, and returns the unsubscribe. */
export class PassEnds extends Context.Service<
  PassEnds,
  {
    /**
     * Run `listener` at the end of every Measure pass: once per pass, after every round's boxes are
     * stored (a blocked pass and one whose flush triggered more rounds included). A listener that
     * throws is logged and doesn't stop the pass or the others.
     */
    readonly onPassEnd: (listener: () => void) => () => void
  }
>()("@wardic/dom/PassEnds") {}
