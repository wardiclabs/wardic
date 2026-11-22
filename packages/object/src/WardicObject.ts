/**
 * Wardic for any object's properties: Motion's `animate` on plain objects (a three.js mesh's material,
 * a camera, a uniforms object, a Canvas 2D sprite, a plain `{ x, y }`), on frames the host pumps. One
 * runtime per Host loop: `make` builds it, the host calls `frame(time)` once a frame before it renders,
 * and `dispose` ends it.
 *
 * - **Keys** are an object's own properties, by name: `animate(sprite, { x: 100 })` writes `sprite.x`.
 *   Each starts from the property's value when the animation starts. A key the object doesn't have,
 *   or whose value is neither a number nor a string, is an error naming it.
 * - **Values** are numbers, and strings with a unit or of numbers (`"10px"`, `"0 0 4px"`). An array in
 *   a target is keyframes, as Motion's.
 * - **Transitions** are Motion's by a key's name when a key gives none: a spring for a transform's
 *   (`x`, `rotate`, `scale`…), a 0.3 s ease for any other.
 * - **The controls** are the DOM's: awaitable, with `stop`, `cancel`, `complete`, `pause`, `play`,
 *   `speed`, `time` and `duration`. A later `animate` of a key takes it over, keeping its velocity.
 *
 * @example
 * import * as WardicObject from "@wardic/object/WardicObject"
 *
 * const wardic = WardicObject.make()
 * renderer.setAnimationLoop((time) => {
 *   wardic.frame(time)
 *   renderer.render(scene, camera)
 * })
 * await wardic.animate(material, { opacity: 0 }, { duration: 0.4 })
 */
// `@wardic/object/WardicObject` (#882; ADR-0068 decisions 2 and 5, ADR-0069 decision 21; ADR-0073,
// *Amendment (#882)*, Q4–Q6): core's Imperative track (`@wardic/core/unstable/Imperative`) over plain
// objects, on `PumpedFrames`, with core's Frame effects at each frame's end (`afterWrites`). Its Batches
// are PR 3's (`ObjectBatch`).
import * as Announcer from "@wardic/core/Announcer"
import * as Clock from "@wardic/core/Clock"
import * as DefaultTransition from "@wardic/core/DefaultTransition"
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InputFeed from "@wardic/core/InputFeed"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Probe from "@wardic/core/Probe"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Config from "@wardic/core/unstable/Config"
import * as FlushGate from "@wardic/core/unstable/FlushGate"
import * as FrameEffects from "@wardic/core/unstable/FrameEffects"
import * as BatchCalls from "@wardic/core/unstable/BatchCalls"
import * as Imperative from "@wardic/core/unstable/Imperative"
import * as Report from "@wardic/core/unstable/Report"
import * as WardicServices from "@wardic/core/unstable/WardicServices"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { constUndefined } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import * as ObjectBatch from "./ObjectBatch.ts"
import * as ObjectRenderer from "./ObjectRenderer.ts"
import * as ObjectValues from "./ObjectValues.ts"
import * as PumpedFrames from "./PumpedFrames.ts"

/** A key of `T` Wardic animates: one whose value is a number or a string. */
export type AnimatableKey<T> = { readonly [K in keyof T]-?: T[K] extends number | string ? K : never }[keyof T] & string

/** A target for `T`: each of its animatable keys a value or keyframes, with a transition and a Transition end. */
export type ObjectTarget<T> = {
  readonly [K in AnimatableKey<T>]?: T[K] | Config.WardicKeyframes<T[K]>
} & {
  readonly transition?: Config.WardicTransition | undefined
  readonly transitionEnd?: { readonly [K in AnimatableKey<T>]?: T[K] } | undefined
}

/** A Segment of objects, `[subject, target, options?]`: an object, or a list of them. Motion's. */
export type ObjectSegment =
  | readonly [subject: object | ReadonlyArray<object>, target: Readonly<Record<string, number | string | Config.WardicKeyframes<number | string>>>]
  | readonly [subject: object | ReadonlyArray<object>, target: Readonly<Record<string, number | string | Config.WardicKeyframes<number | string>>>, options: Imperative.WardicSegmentOptions]

/** A Segment of a Batch, `[batch, target, options?]`: every member, or a member's handle, `batch.at(i)`. */
export type ObjectBatchSegment =
  | readonly [batch: ObjectBatch.ObjectBatch<any> | ObjectBatch.Member<any>, target: Readonly<Record<string, ObjectBatch.SegmentValue>>]
  | readonly [batch: ObjectBatch.ObjectBatch<any> | ObjectBatch.Member<any>, target: Readonly<Record<string, ObjectBatch.SegmentValue>>, options: Imperative.WardicSegmentOptions]

/** A sequence of objects: Segments of objects and of Batches, function Segments and labels. Motion's `AnimationSequence`. */
export type ObjectSequence = ReadonlyArray<Imperative.WardicSequenceLabel | ObjectSegment | ObjectBatchSegment | Imperative.WardicFunctionSegment>

/**
 * `animate(subject, target, options?)` animates an object, or each of a list of them, to `target`;
 * `animate(sequence, options?)` plays a sequence. Either returns its Playback controls. Motion's.
 */
export interface ObjectAnimate {
  <T extends object>(batch: ObjectBatch.ObjectBatch<T> | ObjectBatch.Member<T>, target: ObjectBatch.Target<T>, options?: Imperative.WardicAnimateOptions): Imperative.WardicPlaybackControls
  <T extends object>(subject: T | ReadonlyArray<T>, target: ObjectTarget<T>, options?: Imperative.WardicAnimateOptions): Imperative.WardicPlaybackControls
  (sequence: ObjectSequence, options?: Imperative.WardicSequenceOptions): Imperative.WardicPlaybackControls
}

/** A runtime's options. */
export interface Options {
  /**
   * Whether reduced motion applies (`"user"`, the default: the user's preference where the host
   * reports one, through `matchMedia`, else never; `"always"`; `"never"`). Under it, a transform's
   * keys (`x`, `rotate`, `scale`…) snap to their targets after their delay, and other keys animate.
   */
  readonly reducedMotion?: ReducedMotion.Config | undefined
  /** Land every animation on its next frame: for tests and screenshots, and a user who turned motion off. */
  readonly skipAnimations?: boolean | undefined
  /** The `AtomRegistry` Live values are shared through: the page's, so a DOM value can drive an object's. */
  readonly registry?: AtomRegistry.AtomRegistry | undefined
  /** The host's steady clock on its frames' timebase: `performance.now()` when left out. */
  readonly now?: (() => number) | undefined
}

/** A runtime: what animates objects on one Host loop. */
export interface WardicObject {
  readonly animate: ObjectAnimate
  /**
   * A Batch of `objects`: one run for all of them, on the keys of its first `animate` (or `keys`).
   * `animate(batch, target)` moves every member; `animate(batch.at(i), target)` member `i`.
   */
  readonly batch: <T extends object>(objects: ReadonlyArray<T>, options?: ObjectBatch.Options<T>) => ObjectBatch.ObjectBatch<T>
  /**
   * Run `effect` at the end of each frame from now on, after Wardic's writes for it and the effects
   * added before it, with the frame's time in ms: an app's own code before the render. Returns its remover.
   */
  readonly afterWrites: (effect: (time: number) => void) => () => void
  /** Run the frame, `time` in ms: Wardic's writes for it, then `afterWrites`' effects. Call it once a frame, before rendering. */
  readonly frame: (time: number) => void
  /** Whether Wardic wants another frame: what a loop that draws on demand checks to go on. */
  readonly wantsFrame: () => boolean
  /** Stop every animation, and end the runtime. */
  readonly dispose: () => void
}

/** A media query's answer, where the host has `matchMedia`. */
interface MediaQuery {
  readonly matches: boolean
}

/** The user's reduced-motion query, where the host has `matchMedia`; none in Node or a worker. */
const reducedMotionQuery = (): MediaQuery | undefined =>
  UndefinedOr.match((globalThis as { readonly matchMedia?: ((query: string) => MediaQuery) | undefined }).matchMedia, {
    onUndefined: constUndefined,
    onDefined: (matchMedia) => matchMedia("(prefers-reduced-motion: reduce)"),
  })

/** Whether `query` says the user prefers reduced motion, now. */
const prefersOf = (query: MediaQuery | undefined): boolean => UndefinedOr.match(query, { onUndefined: () => false, onDefined: (given) => given.matches })

/** A box of nothing: an object has no layout to measure. */
const ZERO_BOUNDS: Probe.Bounds = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }

/** The Probe of an Environment with no layout: nothing to measure, observe or intersect; the user's preference as the host reports it. */
const probeLayer = (query: MediaQuery | undefined): Layer.Layer<Probe.Probe> =>
  Layer.succeed(Probe.Probe, {
    measure: () => Effect.succeed(ZERO_BOUNDS),
    viewport: Atom.make({ width: 0, height: 0 }),
    prefersReducedMotion: Atom.make(prefersOf(query)),
    visible: Atom.make(true),
    observeResize: () => Stream.never,
    observeIntersection: () => InputFeed.empty,
  })

/**
 * The object Environment's services, on `frames`: the Effect form, for an app that runs Wardic's
 * Effects itself. `make` builds its runtime on it.
 */
export const layer = (frames: PumpedFrames.PumpedFrames, options: Options = {}): Layer.Layer<WardicServices.WardicServices> =>
  FrameLoop.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Clock.layer.pipe(Layer.provideMerge(PumpedFrames.layer(frames))),
        ObjectRenderer.layer,
        probeLayer(reducedMotionQuery()),
        InterpolatorRegistry.layer,
        ReducedMotion.transformsOnly,
        DefaultTransition.layerByKey,
        Announcer.layerSilent,
      ),
    ),
    Layer.provideMerge(
      UndefinedOr.match(options.registry, {
        onUndefined: () => AtomRegistry.layer,
        onDefined: (registry) => Layer.succeed(AtomRegistry.AtomRegistry, registry),
      }),
    ),
  )

/** The runtime's Flush gate: an object's properties, written once a frame. */
class Gate extends Context.Service<Gate, FlushGate.Shape>()("@wardic/object/WardicObject/Gate") {}

/** The gate, built with its runtime's services and ended with its Scope. */
const gateLayer: Layer.Layer<Gate, never, FlushGate.FlushGateServices> = Layer.effect(Gate)(
  Effect.gen(function* () {
    // An object has no framework to batch a flush's hooks in.
    const gate = FlushGate.makeFlushGate(yield* WardicServices.makeRunner<FlushGate.FlushGateServices>(), { batch: (apply) => apply() }, ObjectRenderer.GATE)
    yield* Effect.addFinalizer(() => Effect.sync(gate.dispose))
    return gate
  }),
)

/** What `given` names as an object: itself, an error for anything that isn't one. */
const objectOf = (given: unknown): object => {
  if (Predicate.isObject(given)) return given
  throw new Error(`wardic.animate: ${String(given)} isn't an object to animate. Give an object, or a list of them.`)
}

/** The objects `given` names: an object, or each of a list of them. */
const resolve = (given: unknown): ReadonlyArray<object> => {
  if (Arr.isArray(given)) return Arr.map(given as ReadonlyArray<unknown>, objectOf)
  return [objectOf(given)]
}

/** An object of a Batch given to `animate` itself: an error naming its handle. */
const memberGiven = (subjects: ReadonlyArray<object>): never => {
  const member = Option.match(Arr.findFirst(Arr.map(subjects, ObjectBatch.memberOf), Predicate.isNotUndefined), { onNone: () => "?", onSome: String })
  throw new Error(`wardic.animate: an object given is member ${member} of a Batch, whose run draws it: animate it through its Batch, batch.at(${member})`)
}

/** The object Environment's Batches: `ObjectBatch`'s handles; a member object is reached through them alone. */
const BATCHES: Imperative.Batches<object> = {
  entryOf: ObjectBatch.entryOf,
  hasMembers: (subjects) => Arr.some(subjects, (subject) => Predicate.isNotUndefined(ObjectBatch.memberOf(subject))),
  callPartsOf: memberGiven,
  segmentSubjectsOf: memberGiven,
  sequencePartsOf: (compiled) => BatchCalls.sequencePartsOf(compiled),
}

/** The object Environment's ports into core's track: its Subjects any object, each starting from its own values. */
const PORTS: Imperative.Ports<object> = {
  subjects: { resolve, startLinksOf: ObjectValues.startLinksOf },
  batches: BATCHES,
}

/** A runtime on frames the host pumps: `frame(time)` once a frame, before it renders. */
export const make = (options: Options = {}): WardicObject => {
  const frames = PumpedFrames.make(options.now)
  const runtime = ManagedRuntime.make(gateLayer.pipe(Layer.provideMerge(layer(frames, options))))
  const { gate, positionalKeys, defaultTransition } = runtime.runSync(
    Effect.all({ gate: Gate, positionalKeys: ReducedMotion.PositionalKeys, defaultTransition: DefaultTransition.DefaultTransition }),
  )
  const config: ReducedMotion.Config = UndefinedOr.match(options.reducedMotion, { onUndefined: () => "user", onDefined: (given) => given })
  const skip = options.skipAnimations === true
  const query = reducedMotionQuery()
  const env: Imperative.AnimateEnv = {
    runtime,
    gate,
    reducedMotion: () => ReducedMotion.applies(config, prefersOf(query)),
    skipAnimations: () => skip,
    positionalKeys,
    defaultTransition,
    ownValues: ObjectValues.ownValues,
    measuredPairs: ObjectValues.measuredPairs,
    variableValues: ObjectValues.variableValues,
  }
  // Its animations in flight, stopped as it ends.
  const live = new Set<Imperative.WardicPlaybackControls>()
  const watch: Imperative.AnimationWatch = {
    started: (controls) => void live.add(controls),
    ended: (controls) => void live.delete(controls),
  }
  const animate = Imperative.make(env, PORTS, constUndefined, watch) as ObjectAnimate
  const effects = FrameEffects.make({
    // The host asks `wantsFrame()`: a request is counted there.
    requestFrame: constUndefined,
    report: (defect) => void runtime.runFork(Report.failure("wardic.afterWrites: an effect failed", Cause.die(defect))),
  })
  const frame = (time: number): void => {
    frames.frame(time)
    effects.run(time)
  }
  const dispose = (): void => {
    Iter.forEach(Arr.fromIterable(live), (controls) => controls.stop())
    void runtime.dispose()
  }
  const batchContext: ObjectBatch.Context = { runFork: runtime.runFork, positionalKeys, defaultTransition }
  return {
    animate,
    batch: (objects, options) => ObjectBatch.make(batchContext, objects, options),
    afterWrites: effects.add,
    frame,
    wantsFrame: () => Bool.or(frames.wantsFrame(), effects.requested()),
    dispose,
  }
}
