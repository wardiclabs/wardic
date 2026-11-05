/**
 * **Animation controls** (#433's PR 3, CONTEXT.md; Motion's `useAnimationControls`), Solid-free: one
 * object made outside any component and given as `animate={controls}` to any number of Wardic
 * elements, which follow its calls.
 *
 * - **`start(definition, transitionOverride)`** sets each element's `animate` entry (a **Controls
 *   change**), so it Retargets, staggers its Variant children and lands as a change of the prop would.
 *   It resolves once each element and the Variant children it hands its names to have landed.
 *   - The override is the transition of that change: it beats the definition's own on the element and
 *     on each Variant child, and it is their orchestration (stagger, `when`), as Motion's
 *     `transitionOverride` is.
 *   - Their next Retarget, a gesture's, runs on their own transitions again.
 * - **`set(definition)`** is a start on an instant transition: the elements and their Variant children
 *   jump there, as Motion's `setValues` sets them.
 * - **`stop()`** ends each element's running legs where they are.
 *
 * A function definition is called once per element, with its `custom`, values and velocities, as
 * Motion's `controls.start((i) => …)`. An element hears the controls from its mount to its unmount.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { WardConfig, WardicTransition, WardicVariant, WardicVariantLabels, WardicVariantResolver } from "./config.ts"

/** What controls start or set an element to: a target, a variant name or a list of them, or a function of each element's `custom`. Motion's `AnimationDefinition`. */
export type WardicControlsDefinition = WardicVariant | WardicVariantLabels | WardicVariantResolver

/** The mark that tells controls from a target. */
const CONTROLS: unique symbol = Symbol("wardic.animationControls")

/**
 * `createAnimationControls()`'s controls: give them as `animate={controls}`, and every element given
 * them follows `start`, `set` and `stop`. Motion's `LegacyAnimationControls`.
 */
// #433.
export interface WardicAnimationControls {
  readonly [CONTROLS]: true
  /**
   * Animates every element given these controls to `definition`, as a change of its `animate` would,
   * its variant children following. `transitionOverride`, when given, is the transition of this change,
   * over the definition's own, and its stagger. Resolves once each element and its children have landed.
   */
  readonly start: (definition: WardicControlsDefinition, transitionOverride?: WardicTransition) => Promise<void>
  /** Sets every element given these controls, and its variant children, at `definition` at once. */
  readonly set: (definition: WardicControlsDefinition) => void
  /** Ends every element's running animation where it is. */
  readonly stop: () => void
}

/**
 * A **Controls change** (#433): what one `start` or `set` set one element's `animate` entry to, the
 * transition it runs on, and the landings it waits for. The element and each Variant child it reaches
 * join it at the Retarget it makes them run, and leave at that one's landing (or the next's).
 */
export interface ControlsChange {
  /** Its place among every change: a trigger key part, so a change is a trigger even to the same name. */
  readonly serial: number
  /** The element's `animate` entry: a target or a name, a resolver already called. */
  readonly definition: WardicVariant | WardicVariantLabels
  /** The transition of the change (start's override, set's instant one), or none: the element's own. */
  readonly override: WardicTransition | undefined
  /** Elements in it that haven't landed. */
  pending: number
  /** Whether every element it reaches has had its chance to join: its binding's flush has run. */
  armed: boolean
  /** Told once it has landed. */
  readonly landed: () => void
}

/** What a controlled element does at a change, as its binding wires it: its entry set, and the change's landing promised. */
export interface Controlled {
  readonly change: (definition: WardicControlsDefinition, override: WardicTransition | undefined) => Promise<void>
  readonly stop: () => void
}

/** The elements each controls reach, by the controls. */
const subscribers = new WeakMap<WardicAnimationControls, Set<Controlled>>()

/** `set`'s transition (#433, Motion's `setValues`): none to speak of, and no orchestration. */
export const INSTANT: WardicTransition = { type: "tween", duration: 0 }

/**
 * Makes animation controls, which animate elements from code by their variants or targets: give them
 * to each element as `animate={controls}`, on a `w.*` element, in a ward's config or on a
 * `Reorder.Item`, then `start`, `set` or `stop` them. Needs no owner. Motion's `useAnimationControls`.
 *
 * @example
 * const controls = createAnimationControls()
 * <w.ul initial="hidden" animate={controls} variants={list}>…</w.ul>
 * await controls.start("visible")
 * @see https://wardic.dev/reference/solid/animation/create-animation-controls
 */
// #433's PR 3: each `start` or `set` is a Controls change of each element's `animate` entry.
export const createAnimationControls = (): WardicAnimationControls => {
  const reached = new Set<Controlled>()
  const controls: WardicAnimationControls = {
    [CONTROLS]: true,
    start: (definition, transitionOverride) =>
      Promise.all(Arr.map(Arr.fromIterable(reached), (element) => element.change(definition, transitionOverride))).then(() => undefined),
    set: (definition) =>
      reached.forEach((element) => {
        void element.change(definition, INSTANT)
      }),
    stop: () => reached.forEach((element) => element.stop()),
  }
  subscribers.set(controls, reached)
  return controls
}

/** Whether `u` is **Animation controls** (Motion's `isAnimationControls`). */
export const isAnimationControls = (u: unknown): u is WardicAnimationControls => Predicate.hasProperty(u, CONTROLS)

/** Reach `element` from `controls`, until the returned function: its mount to its unmount. */
export const subscribe = (controls: WardicAnimationControls, element: Controlled): (() => void) => {
  const reached = subscribers.get(controls)
  if (Predicate.isUndefined(reached)) return () => undefined
  reached.add(element)
  return () => {
    reached.delete(element)
  }
}

/** The changes made, counted. */
// Module state (#460, Q7): an id counter, only compared for order and identity.
let serials = 0

/**
 * A change of one element (#433): its entry, `definition` called with the element's `custom`, values
 * and velocities when it's a resolver (once, as Motion's), on `override`; and its landing, promised. It
 * lands once every element it reaches has joined, at the end of the binding's flush (`armed`), and
 * left. One that reaches no element lands then.
 */
export const changeOf = (
  definition: WardicControlsDefinition,
  override: WardicTransition | undefined,
  custom: unknown,
  values: Readonly<Record<string, number | string>>,
  velocities: Readonly<Record<string, number>>,
): { readonly change: ControlsChange; readonly landing: Promise<void> } => {
  let resolve!: () => void
  const landing = new Promise<void>((done) => {
    resolve = done
  })
  const entry = Bool.match(Predicate.isFunction(definition), {
    onTrue: () => (definition as WardicVariantResolver)(custom, { ...values }, { ...velocities }),
    onFalse: () => definition as WardicVariant | WardicVariantLabels,
  })
  const change: ControlsChange = { serial: ++serials, definition: entry, override, pending: 0, armed: false, landed: resolve }
  return { change, landing }
}

/** An element joins `change`: it runs a Retarget for it. */
export const join = (change: ControlsChange): void => {
  change.pending++
}

/** An element in `change` landed, or left it (a later change, its unmount): it lands once none is left and it's armed. */
export const leave = (change: ControlsChange): void => {
  change.pending--
  if (change.armed && change.pending <= 0) change.landed()
}

/** `change` armed, its binding's flush having run: it lands now if no element joined, or all have left. */
export const arm = (change: ControlsChange): void => {
  change.armed = true
  if (change.pending <= 0) change.landed()
}

/**
 * An element's config with **Animation controls** for its `animate` (#433), as everything but its
 * controls reads it: `change`'s entry (none before the first), and marked controlled, so it names its
 * own variants whatever the entry is (Motion's `isControllingVariants`).
 */
export const controlledConfigOf = <C extends Pick<WardConfig, "animate">>(config: C, change: ControlsChange | undefined): C =>
  ({ ...config, animate: UndefinedOr.map(change, (c) => c.definition), controlled: true }) as C

/** A config as a server reads it (#433): one given **Animation controls** has no entry yet, and is controlled. */
export const uncontrolledOf = <C extends Pick<WardConfig, "animate">>(config: C): C =>
  Bool.match(isAnimationControls(config.animate), { onTrue: () => controlledConfigOf(config, undefined), onFalse: () => config })

/** What a controlled element reads at a change: its `custom`, and its values and velocities now (its Snapshot). */
export interface ControlledState {
  readonly custom: () => unknown
  readonly snapshot: { readonly values: Readonly<Record<string, number | string>>; readonly velocities: Readonly<Record<string, number>> }
}

/**
 * A mounted element as its controls reach it (#433): a change sets its entry through `setChange`, its
 * binding's signal, and arms once the binding's flush has run (a microtask after, Solid 2's included),
 * every element it reaches joined by then; `stop` ends its legs.
 */
export const controlledElement = (setChange: (change: ControlsChange) => void, state: ControlledState, stop: () => void): Controlled => ({
  change: (definition, override) => {
    const made = changeOf(definition, override, state.custom(), state.snapshot.values, state.snapshot.velocities)
    setChange(made.change)
    queueMicrotask(() => arm(made.change))
    return made.landing
  },
  stop,
})
