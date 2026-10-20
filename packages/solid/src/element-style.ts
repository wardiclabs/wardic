/**
 * The `style` a Wardic element is rendered with, for a `createWard` spread and a
 * `wardic.create(Component)` wrap (ADR-0021 decision 6, ADR-0034). The flush gate commits every
 * frame onto the element, so `style` carries Wardic's values only until the first commit:
 *
 * - until then, the user's style with the Starting style on top: what a server renders, what
 *   hydration keeps, and what the element shows before its first frame;
 * - from the first commit, the fallback: the user's style without the keys the gate holds on the
 *   element. Wardic writes those while it drives them; a key the gate lets go of comes back.
 *
 * The gate switches it through the sink's hooks, outside its commits: `beforeFirstCommit`, and
 * `onHeld` whenever the keys it holds change. Only a change to a key the element's own style
 * sets re-runs `style`, so a frame never does.
 *
 * The user's routed keys (#130, ADR-0043: its Live values and transform keys) are never Solid's:
 * the Starting style carries their values, and from mount the gate holds them. Each style the
 * user gives is seen by the element's {@link LiveStyle} here, where it's read reactively.
 *
 * Solid-free (#209): its state is plain, and one {@link Trigger} re-runs `style`, so it reads the
 * same under Solid 2, where a signal's read lags its write until the flush.
 */
import type * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Style from "@wardic/dom/Style"
import * as Bool from "effect/Boolean"
import { constUndefined, pipe } from "effect/Function"
import * as Rec from "effect/Record"
import type { LiveStyle } from "./live-style.ts"
import type { Reactivity } from "./reactivity.ts"

/** What {@link createElementStyle} reads. */
export interface ElementStyleOptions {
  /** The user's current style, read when the keys the gate holds change. */
  readonly userStyle: () => object | string | undefined
  /** The element's Starting style, with no routed key. */
  readonly starting: Renderer.Patch
  /** The element's Starting style with its routed keys at `routed` (#130). */
  readonly startingWith: (routed: Values.Values) => Renderer.Patch
  /** The element's routed `style` keys (#130). */
  readonly live: LiveStyle
  /** A drag element's defaults, under the user's style. */
  readonly defaults: Style.DragDefaults | undefined
  /** A `<Reorder>` item's base style, under the user's style. */
  readonly base?: (() => object | undefined) | undefined
  /** The binding's Solid (#209). */
  readonly reactivity: Reactivity
}

/** An element's `style` and the sink hooks that switch it. */
export interface ElementStyle {
  /** The element's style, given the user's: reactive, read inside the element's JSX. */
  readonly style: (user: object | string | undefined) => Style.Style
  /** The hooks the element's flush sink carries. */
  readonly hooks: Required<Pick<FlushGate.Sink, "beforeFirstCommit" | "onHeld">>
}

/** An element's `style`, switched by its flush sink's hooks. Call within a Solid owner. */
export const createElementStyle = (options: ElementStyleOptions): ElementStyle => {
  const { userStyle, starting, startingWith, live, defaults, base = constUndefined, reactivity } = options
  const { untrack } = reactivity
  // Whether the gate has committed: `style` re-runs once, at the first commit.
  let committed = false
  // Every key the gate holds, current whenever `style` runs. A change that touches the
  // element's own style re-runs it; any other change waits for the next run.
  let held: ReadonlyArray<string> = []
  const changed = reactivity.trigger()

  // The Starting style with the routed keys' values now: read before the first commit only.
  const startingNow = (): Renderer.Patch => {
    const routed = live.values()
    return Bool.match(Rec.isEmptyRecord(routed), { onTrue: () => starting, onFalse: () => startingWith(routed) })
  }

  const style = (user: object | string | undefined): Style.Style => {
    changed.track()
    const css = live.css(user)
    return Bool.match(committed, {
      onFalse: () => pipe(startingNow(), Style.over(css), Style.over(base()), Style.over(defaults)),
      onTrue: () => pipe(css, Style.over(base()), Style.over(defaults), Style.without(held)),
    })
  }

  const onHeld = (next: ReadonlyArray<string>): void => {
    const prev = held
    held = next
    if (!committed) return
    const style = pipe(live.css(untrack(userStyle)), Style.over(untrack(base)), Style.over(defaults))
    if (Style.heldTouches(style, prev, next)) changed.notify()
  }

  const beforeFirstCommit = (): void => {
    committed = true
    changed.notify()
  }

  return { style, hooks: { beforeFirstCommit, onHeld } }
}
