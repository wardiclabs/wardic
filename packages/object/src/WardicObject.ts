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
import type * as Renderer from "@wardic/core/Renderer"
import type * as Batch from "@wardic/core/Batch"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as UnitScale from "@wardic/core/UnitScale"
import type * as Config from "@wardic/core/unstable/Config"
import * as FlushGate from "@wardic/core/unstable/FlushGate"
import type * as OwnValues from "@wardic/core/unstable/OwnValues"
import type * as Spine from "@wardic/core/unstable/Spine"
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

/**
 * A target for `T`: each of its animatable keys a value or keyframes; a transition, with an entry
 * under any of those keys, which `animate`'s options are laid over field by field; and a Transition
 * end, its values set once the object lands.
 */
export type ObjectTarget<T> = {
  readonly [K in AnimatableKey<T>]?: ValueAt<T, K>
} & {
  /** How it gets there: a spring, a tween or an inertia, with an entry under any of `T`'s keys it animates. */
  readonly transition?: Config.WardicTransitionFor<AnimatableKey<T>> | undefined
  readonly transitionEnd?: EndOf<T> | undefined
}

/** A target's value for `T`'s key `K`: one of its values, or keyframes of them. */
type ValueAt<T, K extends keyof T> = T[K] | Config.WardicKeyframes<T[K]>

/** `T`'s Transition end: values for its animatable keys, set once it lands. */
type EndOf<T> = { readonly [K in AnimatableKey<T>]?: T[K] }

/**
 * A target for `T` whose keys are any name (it has an index signature), checked key by key as given
 * (`G`): `transition` as a transition, `transitionEnd` as its Transition end, and any other key as one
 * of `T`'s values or keyframes. Since any name is one of its keys, a misspelt key isn't caught.
 */
// #958: as an ObjectTarget, its keys an index signature, `transition` and `transitionEnd` would have
// to be values too, which no transition is.
type AnyKeyTarget<T, G> = {
  readonly [P in keyof G]: P extends "transition"
    ? Config.WardicTransitionFor<AnimatableKey<T>> | undefined
    : P extends "transitionEnd"
      ? EndOf<T> | undefined
      : ValueAt<T, P & keyof T>
}

/** `animate`'s target for `T`: an {@link ObjectTarget}, or, where `T`'s keys are any name, the target given, checked key by key. */
type TargetFor<T, G> = string extends AnimatableKey<T> ? AnyKeyTarget<T, G> : ObjectTarget<T>

/** A Segment of objects, `[subject, target, options?]`: an object, or a list of them. Motion's. */
export type ObjectSegment =
  | readonly [subject: object | ReadonlyArray<object>, target: Readonly<Record<string, number | string | Config.WardicKeyframes<number | string>>>]
  | readonly [subject: object | ReadonlyArray<object>, target: Readonly<Record<string, number | string | Config.WardicKeyframes<number | string>>>, options: Imperative.WardicSegmentOptions]

/** A Segment of a Batch, `[batch, target, options?]`: every member, or a member's handle, `batch.at(i)`. */
export type ObjectBatchSegment =
  | readonly [batch: ObjectBatch.ObjectBatch<any, any> | ObjectBatch.Member<any, any>, target: Readonly<Record<string, ObjectBatch.SegmentValue>>]
  | readonly [batch: ObjectBatch.ObjectBatch<any, any> | ObjectBatch.Member<any, any>, target: Readonly<Record<string, ObjectBatch.SegmentValue>>, options: Imperative.WardicSegmentOptions]

/** A sequence of objects: Segments of objects and of Batches, function Segments and labels. Motion's `AnimationSequence`. */
export type ObjectSequence = ReadonlyArray<Imperative.WardicSequenceLabel | ObjectSegment | ObjectBatchSegment | Imperative.WardicFunctionSegment>

/**
 * `animate(subject, target, options?)` animates an object, or each of a list of them, to `target`;
 * `animate(sequence, options?)` plays a sequence. Either returns its Playback controls. Motion's.
 * The options' transition takes an entry under any of the keys the Subject animates: a Batch's, its keys.
 * A Subject whose keys are any name (an index signature) has its target checked key by key as given;
 * naming its type, `animate<T>(…)`, checks its keys as values only.
 */
export interface ObjectAnimate {
  <T extends object>(batch: ObjectBatch.ObjectBatch<T> | ObjectBatch.Member<T>, target: ObjectBatch.Target<T>, options?: Imperative.WardicAnimateOptionsFor<ObjectBatch.NumberKey<T>>): Imperative.WardicPlaybackControls
  <T extends object, const G extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>(
    subject: T | ReadonlyArray<T>,
    target: TargetFor<T, G>,
    options?: Imperative.WardicAnimateOptionsFor<AnimatableKey<T>>,
  ): Imperative.WardicPlaybackControls
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

/**
 * What a binding's ward runs on, to move this runtime's Subjects as a ward moves an element: what
 * `animate` runs on, where a Subject starts, and its Frame effects. Unstable: for `@wardic/solid`'s
 * Stage ward and the Stages built on it.
 */
// #884's PR 4 (ADR-0073, *Amendment (#884)*, Q2 and Q3): `makeWith`'s own parts, opened up, not copied.
export interface StageEnvironment extends Imperative.AnimateEnv {
  /** Where each key of a Subject starts: its Environment's Base-value links. */
  readonly startLinksOf: (subject: object) => Spine.StartLinks
  /** Its Frame effects: what `afterWrites` adds to, and how one asks for a frame. */
  readonly frameEffects: Pick<FrameEffects.FrameEffects, "add" | "request">
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
  /** What a binding's ward runs on, for this runtime's Subjects. Unstable: `@wardic/solid`'s Stage ward's. */
  readonly stageEnvironment: StageEnvironment
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
 * A Batch of something that isn't a list of Subjects, an `InstancedMesh`'s instances: a handle per
 * member, and how they're drawn and read.
 */
// #883's PR 4 (ADR-0073, *Amendment (#883)*, PR 4's Q1): one writer per source, since its `flush` is the source's.
export interface BatchSource {
  /** Its members, in order: what the writer and the read are given for each. */
  readonly members: ReadonlyArray<object>
  /** How its members are drawn. */
  readonly writer: Batch.Writer<object>
  /** How it reads a member's key before the Batch moves it. */
  readonly read: (subject: object, key: string) => unknown
}

/**
 * What an Environment of objects gives the runtime: how its Subjects are written and read, which of its
 * keys are positional, how a Batch of them is drawn, and any Layers of its own. `OBJECTS` is plain
 * objects'; `@wardic/three` gives three's.
 */
// #883 (ADR-0073, *Amendment (#883)*, Q1): `make`'s parts, opened up for another Environment of objects.
export interface Environment {
  /** Its writer: Wardic's values onto a Subject, once a frame. */
  readonly renderer: Layer.Layer<Renderer.Renderer>
  /** What its Flush gate reads of a Subject. */
  readonly gate: FlushGate.GateEnvironment
  /** A plain Subject's Base-value links: where each key it animates starts. */
  readonly startLinksOf: (subject: object) => Spine.StartLinks
  /** Its values in the shape of their targets. */
  readonly ownValues: OwnValues.Shape
  /** Which of its keys reduced motion snaps. */
  readonly positionalKeys: Layer.Layer<ReducedMotion.PositionalKeys>
  /** How a Batch of its Subjects is drawn. */
  readonly batchWriter: Batch.Writer<object>
  /** How a Batch reads a member's key before it moves it. */
  readonly batchRead: (subject: object, key: string) => unknown
  /**
   * A Batch of `given`, something other than a list (an `InstancedMesh`): its members, drawn and read
   * its own way. `undefined` for anything it doesn't make a Batch of.
   */
  readonly batchSource?: ((given: object) => BatchSource | undefined) | undefined
  /** Layers of its own: its `UnitScale`, say. */
  readonly layers?: Layer.Layer<never> | undefined
}

/** Plain objects' Environment: each key the object's own property. */
export const OBJECTS: Environment = {
  renderer: ObjectRenderer.layer,
  gate: ObjectRenderer.GATE,
  startLinksOf: ObjectValues.startLinksOf,
  ownValues: ObjectValues.ownValues,
  positionalKeys: ReducedMotion.transformsOnly,
  batchWriter: ObjectBatch.writer,
  batchRead: ObjectBatch.read,
}

/**
 * The Environment's services, on `frames`: the Effect form, for an app that runs Wardic's Effects
 * itself. `make` builds its runtime on it; `environment` is plain objects' unless given.
 */
export const layer = (frames: PumpedFrames.PumpedFrames, options: Options = {}, environment: Environment = OBJECTS): Layer.Layer<WardicServices.WardicServices> =>
  FrameLoop.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Clock.layer.pipe(Layer.provideMerge(PumpedFrames.layer(frames))),
        environment.renderer,
        probeLayer(reducedMotionQuery()),
        InterpolatorRegistry.layer,
        environment.positionalKeys,
        DefaultTransition.layerByKey,
        Announcer.layerSilent,
        UndefinedOr.match(environment.layers, { onUndefined: () => Layer.empty, onDefined: (given) => given }),
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

/** The gate on `edges`, built with its runtime's services and ended with its Scope. */
const gateLayerOf = (edges: FlushGate.GateEnvironment): Layer.Layer<Gate, never, FlushGate.FlushGateServices> =>
  Layer.effect(Gate)(
    Effect.gen(function* () {
      // An object has no framework to batch a flush's hooks in.
      const gate = FlushGate.makeFlushGate(yield* WardicServices.makeRunner<FlushGate.FlushGateServices>(), { batch: (apply) => apply() }, edges)
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

/** An Environment's ports into core's track: its Subjects any object, each starting where the Environment reads it. */
const portsOf = (environment: Environment): Imperative.Ports<object> => ({
  subjects: { resolve, startLinksOf: environment.startLinksOf },
  batches: BATCHES,
})

/** A runtime on frames the host pumps, for plain objects: `frame(time)` once a frame, before it renders. */
export const make = (options: Options = {}): WardicObject => makeWith(OBJECTS, options)

/** A runtime on frames the host pumps, for `environment`'s objects: what `@wardic/three` builds on. */
export const makeWith = (environment: Environment, options: Options = {}): WardicObject => {
  const frames = PumpedFrames.make(options.now)
  const runtime = ManagedRuntime.make(gateLayerOf(environment.gate).pipe(Layer.provideMerge(layer(frames, options, environment))))
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
    ownValues: environment.ownValues,
    measuredPairs: ObjectValues.measuredPairs,
    variableValues: ObjectValues.variableValues,
  }
  // Its animations in flight, stopped as it ends.
  const live = new Set<Imperative.WardicPlaybackControls>()
  const watch: Imperative.AnimationWatch = {
    started: (controls) => void live.add(controls),
    ended: (controls) => void live.delete(controls),
  }
  const animate = Imperative.make(env, portsOf(environment), constUndefined, watch) as ObjectAnimate
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
  const batchContext: ObjectBatch.Context = { runFork: runtime.runFork, positionalKeys, defaultTransition, unitScale: runtime.runSync(UnitScale.UnitScale), writer: environment.batchWriter, read: environment.batchRead }
  /** What the Environment makes a Batch of `given`, a Batch's source other than a list: `undefined` where it makes none. */
  const sourceOf = (given: unknown): BatchSource | undefined => {
    if (!Predicate.isObject(given) || Predicate.isUndefined(environment.batchSource)) return undefined
    return environment.batchSource(given)
  }
  /** A Batch of a list of Subjects, or of what the Environment's `batchSource` makes one of. */
  const batch = <T extends object>(given: ReadonlyArray<T>, options?: ObjectBatch.Options<T>): ObjectBatch.ObjectBatch<T> => {
    if (Arr.isArray(given)) return ObjectBatch.make<T>(batchContext, given as ReadonlyArray<T>, options)
    const source = sourceOf(given)
    if (Predicate.isUndefined(source)) throw new Error("wardic.batch: a Batch is made of a list of objects, and it was given something else. Give a list: wardic.batch([a, b, c]).")
    return ObjectBatch.make<T>({ ...batchContext, writer: source.writer, read: source.read }, source.members as ReadonlyArray<T>, options)
  }
  return {
    animate,
    batch,
    afterWrites: effects.add,
    frame,
    wantsFrame: () => Bool.or(frames.wantsFrame(), effects.requested()),
    dispose,
    stageEnvironment: { ...env, startLinksOf: environment.startLinksOf, frameEffects: effects },
  }
}
