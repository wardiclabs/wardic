/**
 * The `style` a Wardic element is rendered with, for a `useWardic` spread and a
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
 */
import type * as Renderer from "@wardic/core/Renderer"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Style from "@wardic/dom/Style"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import { createSignal, type JSX, untrack } from "solid-js"

/** What {@link createElementStyle} reads. */
export interface ElementStyleOptions {
  /** The user's current style, read when the keys the gate holds change. */
  readonly userStyle: () => object | string | undefined
  /** The element's Starting style. */
  readonly starting: Renderer.Patch
  /** A drag element's defaults, under the user's style. */
  readonly defaults: Style.DragDefaults | undefined
  /** A `<Reorder>` item's base style, under the user's style. */
  readonly base?: (() => object | undefined) | undefined
}

/** An element's `style` and the sink hooks that switch it. */
export interface ElementStyle {
  /** The element's style, given the user's: reactive, read inside the element's JSX. */
  readonly style: (user: object | string | undefined) => JSX.CSSProperties
  /** The hooks the element's flush sink carries. */
  readonly hooks: Required<Pick<FlushGate.Sink, "beforeFirstCommit" | "onHeld">>
}

/** An element's `style`, switched by its flush sink's hooks. Call within a Solid owner. */
export const createElementStyle = (options: ElementStyleOptions): ElementStyle => {
  const { userStyle, starting, defaults, base = constUndefined } = options
  const [committed, setCommitted] = createSignal(false)
  // Every key the gate holds, current whenever `style` runs. A change that touches the
  // element's own style re-runs it; any other change waits for the next run.
  let held: ReadonlyArray<string> = []
  const [heldChanged, markHeldChanged] = createSignal(undefined, { equals: false })

  const style = (user: object | string | undefined): JSX.CSSProperties =>
    Bool.match(committed(), {
      onFalse: () => Style.merge(user, starting, defaults, base()) as JSX.CSSProperties,
      onTrue: () => {
        heldChanged()
        return Style.fallback(user, held, defaults, base()) as JSX.CSSProperties
      },
    })

  const onHeld = (next: ReadonlyArray<string>): void => {
    const prev = held
    held = next
    if (!untrack(committed)) return
    if (Style.heldTouches(prev, next, Style.merge(untrack(userStyle), {}, defaults, untrack(base)))) markHeldChanged()
  }

  return { style, hooks: { beforeFirstCommit: () => setCommitted(true), onHeld } }
}
