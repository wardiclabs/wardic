/**
 * **Animation controls** (#433's PR 3, CONTEXT.md; Motion's `useAnimationControls`), on every binding:
 * one object made outside any component and given as `animate={controls}` to any number of Wardic
 * elements, which follow its calls.
 *
 * - **`start(definition, transitionOverride)`** sets each element's `animate` entry (a **Controls
 *   change**), so it Retargets, staggers its Variant children and lands as a change of the prop would.
 *   It resolves once each element and the Variant children it hands its names to have landed.
 *   - The override is the transition of that change: it beats the definition's own on the element and
 *     on each Variant child, and it is their orchestration (stagger, `when`), as Motion's
 *     `transitionOverride` is.
 *   - Their next Retarget, a gesture's, runs on their own transitions again.
 * - **`set(definition)`** is an **Instant change**: the elements and their Variant children
 *   snap there, as Motion's `setValues` sets them.
 * - **`stop()`** ends each element's running legs where they are.
 *
 * A function definition is called once per element, with its `custom`, values and velocities, as
 * Motion's `controls.start((i) => …)`, every element's before any is set: one that throws for an element
 * refuses the call, taking nothing. An element hears the controls from its mount to its unmount.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: solid's `animation-controls.ts`, moved for the spine to join and
// leave a Controls change in core.
import type * as Values from "../Values.ts"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Config from "./Config.ts"

// #672: declared here, as core's `Microtask.ts` declares it, since core builds with no DOM in its lib.
declare const queueMicrotask: (callback: () => void) => void

// #672: the controls' interface, its definition and its mark are Config's, where the config types
// reach them.
export type { WardicAnimationControls, WardicControlsDefinition } from "./Config.ts"

/**
 * A **Controls change** (#433): what one `start` or `set` set one element's `animate` entry to, the
 * transition it runs on, and the landings it waits for. The element and each Variant child it reaches
 * join it at the Retarget it makes them run, and leave at that one's landing (or the next's).
 */
export interface ControlsChange {
  /** Its place among every change: a trigger key part, so a change is a trigger even to the same name. */
  readonly serial: number
  /** The element's `animate` entry: a target or a name, a resolver already called. */
  readonly definition: Config.WardicVariant | Config.WardicVariantLabels
  /** The transition of the change (start's override, set's instant one), or none: the element's own. */
  readonly override: Config.WardicTransition | undefined
  /** Elements in it that haven't landed. */
  pending: number
  /** Whether every element it reaches has had its chance to join: its binding's flush has run. */
  armed: boolean
  /** Told once it has landed. */
  readonly landed: () => void
}

/** What a controlled element does at a change, as its binding wires it: its entry worked out, then set, and the change's landing promised. */
export interface Controlled {
  /** Its entry for `definition`: a function definition called with its `custom`, values and velocities; anything else as it is. */
  readonly entryOf: (definition: Config.WardicControlsDefinition) => Config.WardicVariant | Config.WardicVariantLabels
  readonly change: (entry: Config.WardicVariant | Config.WardicVariantLabels, override: Config.WardicTransition | undefined) => Promise<void>
  readonly stop: () => void
}

/** The elements each controls reach, by the controls. */
// Module state (#460, Q7): each controls object's subscribers, held weakly by it.
const subscribers = new WeakMap<Config.WardicAnimationControls, Set<Controlled>>()

/** `set`'s transition (#433, Motion's `setValues`): none to speak of, and no orchestration. */
export const INSTANT: Config.WardicTransition = { type: "tween", duration: 0 }

/**
 * Each element's entry for `definition`, worked out before any is set: a function definition that throws
 * for one refuses the call, taking nothing, as an `animate()` call refuses one.
 */
// #979 (ADR-0074, row 35): `start` and `set` set each element's entry as they called its function, so one
// that threw for a later element left the earlier ones changed and the rest unreached, as #986's row 20.
const entriesOf = (elements: ReadonlyArray<Controlled>, definition: Config.WardicControlsDefinition): ReadonlyArray<Config.WardicVariant | Config.WardicVariantLabels> =>
  Arr.map(elements, (element) => element.entryOf(definition))

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
export const createAnimationControls = (): Config.WardicAnimationControls => {
  const reached = new Set<Controlled>()
  const controls: Config.WardicAnimationControls = {
    [Config.CONTROLS]: true,
    start: (definition, transitionOverride) => {
      const elements = Arr.fromIterable(reached)
      const entries = entriesOf(elements, definition)
      return Promise.all(Arr.zipWith(elements, entries, (element, entry) => element.change(entry, transitionOverride))).then(() => undefined)
    },
    set: (definition) => {
      const elements = Arr.fromIterable(reached)
      const entries = entriesOf(elements, definition)
      Arr.forEach(Arr.zip(elements, entries), ([element, entry]) => {
        void element.change(entry, INSTANT)
      })
    },
    stop: () => reached.forEach((element) => element.stop()),
  }
  subscribers.set(controls, reached)
  return controls
}

/** Whether `u` is **Animation controls** (Motion's `isAnimationControls`). */
export const isAnimationControls = (u: unknown): u is Config.WardicAnimationControls => Predicate.hasProperty(u, Config.CONTROLS)

/** An element's `animate` as **Animation controls**, when it is them: what a binding reads once at its mount (#798); `undefined` for a target or a name. */
export const controlsOf = (animate: unknown): Config.WardicAnimationControls | undefined =>
  Bool.match(isAnimationControls(animate), { onTrue: () => animate as Config.WardicAnimationControls, onFalse: constUndefined })

/** Reach `element` from `controls`, until the returned function: its mount to its unmount. */
export const subscribe = (controls: Config.WardicAnimationControls, element: Controlled): (() => void) => {
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
 * An element's entry for `definition`: a resolver called with its `custom`, values and velocities (once,
 * as Motion's), anything else as it is.
 */
// #433; #979 (row 35): worked out for every element before any is set.
export const entryOf = (
  definition: Config.WardicControlsDefinition,
  custom: unknown,
  values: Readonly<Record<string, number | string>>,
  velocities: Readonly<Record<string, number>>,
): Config.WardicVariant | Config.WardicVariantLabels =>
  Bool.match(Predicate.isFunction(definition), {
    onTrue: () => (definition as Config.WardicVariantResolver)(custom, { ...values }, { ...velocities }),
    onFalse: () => definition as Config.WardicVariant | Config.WardicVariantLabels,
  })

/**
 * A change of one element: its entry, on `override`, and its landing, promised. It lands once every
 * element it reaches has joined, at the end of the binding's flush (`armed`), and left. One that reaches
 * no element lands then.
 */
// #433.
export const changeOf = (
  entry: Config.WardicVariant | Config.WardicVariantLabels,
  override: Config.WardicTransition | undefined,
): { readonly change: ControlsChange; readonly landing: Promise<void> } => {
  let resolve!: () => void
  const landing = new Promise<void>((done) => {
    resolve = done
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
export const controlledConfigOf = <C extends Pick<Config.SpineConfig, "animate">>(config: C, change: ControlsChange | undefined): C =>
  ({ ...config, animate: UndefinedOr.map(change, (c) => c.definition), controlled: true }) as C

/** A config as a server reads it (#433): one given **Animation controls** has no entry yet, and is controlled. */
export const uncontrolledOf = <C extends Pick<Config.SpineConfig, "animate">>(config: C): C =>
  Bool.match(isAnimationControls(config.animate), { onTrue: () => controlledConfigOf(config, undefined), onFalse: () => config })

/** What a controlled element reads at a change: its `custom`, and its values and velocities now (its Snapshot). */
export interface ControlledState {
  readonly custom: () => unknown
  /** Its Snapshot: its values, and its velocities now (#663), a spring leg's being on its Frame. */
  readonly snapshot: ControlledSnapshot
}

/** What Animation controls read of an element's Snapshot: its values, and its velocities now (#663). */
// #672: the controls name what they read, so they import nothing of the spine, whose Snapshot meets it.
export interface ControlledSnapshot {
  readonly values: Values.Values
  velocitiesNow(snapshot: ControlledSnapshot): Readonly<Record<string, number>>
}

/**
 * A mounted element as its controls reach it (#433): a change sets its entry through `setChange`, its
 * binding's signal, and arms once the binding's flush has run (a microtask after, Solid 2's included),
 * every element it reaches joined by then; `stop` ends its legs.
 */
export const controlledElement = (setChange: (change: ControlsChange) => void, state: ControlledState, stop: () => void): Controlled => ({
  entryOf: (definition) => entryOf(definition, state.custom(), state.snapshot.values, state.snapshot.velocitiesNow(state.snapshot)),
  change: (entry, override) => {
    const made = changeOf(entry, override)
    setChange(made.change)
    queueMicrotask(() => arm(made.change))
    return made.landing
  },
  stop,
})
