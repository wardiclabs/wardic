/**
 * Wardic for three.js: Motion's `animate` on a scene's meshes, materials, cameras, lights and uniforms,
 * on frames the Host loop pumps. One runtime per Host loop: `make` builds it, the loop calls
 * `frame(time)` once a frame before it renders, and `dispose` ends it.
 *
 * - **Transform keys** are Motion's names: `x`, `y` and `z` move `position`; `rotateX`, `rotateY` and
 *   `rotateZ` turn `rotation`, in degrees; `scale` sets all three scales, and `scaleX`, `scaleY` and
 *   `scaleZ` one each.
 * - **Any other key** is the object's own number (a camera's `fov`, a light's `intensity`), else its
 *   material's (`opacity`, `roughness`: on every mesh that shares the material), a uniform's, or a
 *   vector's axis (`emissiveIntensity`, `uProgress`, `positionX`). The types are three's own:
 *   `animate(mesh, { rotatY: 90 })` is an error.
 * - **Colours** (`color`, `emissive`, a uniform's `Color`) take a CSS colour, a hex number or a
 *   `Color`, and blend in linear light, three's: red to blue passes `#bc00bc`. A spring keeps a
 *   colour's speed through a change of target, as it keeps a position's.
 * - **A Batch** (`batch`) moves many objects as one run, or an `InstancedMesh`'s instances: each by
 *   its transforms and its instance colour, its matrix written in place.
 * - **Units:** `x`, `y` and `z` are metres, so springs rest within millimetres (`unitScale`).
 * - **three's rules after a write:** a camera's projection keys update its projection matrix, and an
 *   `opacity` below 1 draws its material transparent.
 * - **Hover and press** (`hover`, `press`), given `make`'s `canvas`, `camera` and `scene`: a pointer hits
 *   the nearest drawn object under it, cast once a frame (`ThreeInput`).
 *
 * @example
 * import * as WardicThree from "@wardic/three/WardicThree"
 *
 * const wardic = WardicThree.make()
 * renderer.setAnimationLoop((time) => {
 *   wardic.frame(time)
 *   renderer.render(scene, camera)
 * })
 * wardic.animate(cube, { y: 2, rotateY: 180 }, { type: "spring", bounce: 0.3 })
 * await wardic.animate(cube, { opacity: 0 }, { duration: 0.4 })
 */
// `@wardic/three/WardicThree` (#883; ADR-0069 decisions 3–9 and 21, ADR-0073 *Amendment (#883)*, Q1–Q3):
// `@wardic/object`'s runtime through `WardicObject.makeWith`, on three's Environment. The scene's input
// (`hover`, `press`, the raycast) is #883's PR 5a (`ThreeInput`); colours are PR 3's (`ThreeColours`), split at the call
// into their channels; an `InstancedMesh`'s instances PR 4's (`ThreeInstances`, its Environment's `batchSource`).
import * as UnitScale from "@wardic/core/UnitScale"
import type * as Config from "@wardic/core/unstable/Config"
import * as Imperative from "@wardic/core/unstable/Imperative"
import * as ObjectBatch from "@wardic/object/ObjectBatch"
import * as ObjectValues from "@wardic/object/ObjectValues"
import * as WardicObject from "@wardic/object/WardicObject"
import * as Arr from "effect/Array"
import { constUndefined } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import type { Camera, Object3D } from "three"
import * as ThreeColours from "./ThreeColours.ts"
import type * as InputSource from "@wardic/core/InputSource"
import * as ThreeInput from "./ThreeInput.ts"
import * as ThreeInstances from "./ThreeInstances.ts"
import * as ThreeRenderer from "./ThreeRenderer.ts"
import * as ThreeValues from "./ThreeValues.ts"

/** A scene object's transform keys: its position, its rotation in degrees, and its scales. */
// ADR-0069 decision 4.
export type TransformKey = "x" | "y" | "z" | "rotateX" | "rotateY" | "rotateZ" | "scale" | "scaleX" | "scaleY" | "scaleZ"

/** `T`'s keys that hold a number, but its `id`, which three makes read-only. */
// #968: three defines a scene object's and a material's `id` read-only, so its write threw each frame.
type SceneNumberKey<T> = Exclude<{ readonly [K in keyof T]-?: T[K] extends number ? K : never }[keyof T] & string, "id">

/** The axes of a three vector, by its flag: `X`, `Y`, and `Z` and `W` where it has them. */
type AxesOf<V> = V extends { readonly isVector4: true } ? "X" | "Y" | "Z" | "W" : V extends { readonly isVector3: true } ? "X" | "Y" | "Z" : V extends { readonly isVector2: true } ? "X" | "Y" : never

/** `T`'s vectors' axes as keys: `positionX`, `uOffsetY`. */
type VectorKey<T> = { readonly [K in keyof T]-?: K extends string ? `${K}${AxesOf<T[K]>}` : never }[keyof T]

/** A three `Color`, by its flag. */
type IsColor = { readonly isColor: true }

/** `T`'s keys that hold a three `Color`. */
type ColourKeyOf<T> = { readonly [K in keyof T]-?: T[K] extends IsColor ? K : never }[keyof T] & string

/** A colour's channel keys, in linear light: `colorR`, `colorG`, `colorB`. */
type ChannelKey<K extends string> = `${K}${(typeof ThreeColours.CHANNELS)[number]}`

/** The names of `U`'s uniforms that hold a number, a vector's axes, or a colour's channels. An array has none. */
// #963: as AnimatableKey's, over an array the mapped keys come out as `string`; `[U]`, so a union keeps
// only the uniforms its members share.
type UniformKey<U> = [U] extends [ReadonlyArray<unknown>]
  ? never
  : {
      readonly [K in keyof U]-?: U[K] extends { value: number } ? K : U[K] extends { value: IsColor } ? (K extends string ? ChannelKey<K> : never) : U[K] extends { value: infer V } ? (K extends string ? `${K}${AxesOf<V>}` : never) : never
    }[keyof U] & string

/** The names of `U`'s uniforms that hold a `Color`. An array has none. */
// #963: as UniformKey's.
type UniformColourKey<U> = [U] extends [ReadonlyArray<unknown>] ? never : { readonly [K in keyof U]-?: U[K] extends { value: IsColor } ? K : never }[keyof U] & string

/** The uniforms `M` holds, a `ShaderMaterial`'s. */
type UniformsOf<M> = M extends { readonly uniforms: infer U } ? U : never

/** The number keys of `M`, a material: its numbers, its vectors' axes, its colours' channels, and its uniforms'. */
type MaterialKey<M> = SceneNumberKey<M> | VectorKey<M> | ChannelKey<ColourKeyOf<M>> | UniformKey<UniformsOf<M>>

/** The colour keys of `M`, a material: its `Color`s and its uniforms'. */
type MaterialColourKey<M> = ColourKeyOf<M> | UniformColourKey<UniformsOf<M>>

/** The material a mesh's `material` gives it: each of an array of them. */
type MaterialOf<T> = T extends { readonly material: infer M } ? (M extends ReadonlyArray<infer E> ? E : M) : never

/** The number keys of a three Subject `T`: a scene object's transforms, numbers and vectors' axes, and its material's; a material's own. Not their `id`, which three makes read-only. */
export type SceneKey<T> = T extends { readonly isObject3D: true } ? TransformKey | SceneNumberKey<T> | VectorKey<T> | MaterialKey<MaterialOf<T>> : T extends { readonly isMaterial: unknown } ? MaterialKey<T> : never

/** The colour keys of a three Subject `T`: its material's `Color`s for a scene object, a material's own, a uniforms object's. */
export type ColourKey<T> = T extends { readonly isObject3D: true } ? ColourKeyOf<T> | MaterialColourKey<MaterialOf<T>> : T extends { readonly isMaterial: unknown } ? MaterialColourKey<T> : UniformColourKey<T>

/** A key's value in a scene: a number, or keyframes of them. */
type SceneValue = number | Config.WardicKeyframes<number>

/** A colour key's value: a colour, or keyframes of them. */
type ColourTargetValue = ThreeColours.ColourValue | Config.WardicKeyframes<ThreeColours.ColourValue>

/** A key's value among number keys `K` and colour keys `C`: either, for a key in both (a `ShaderMaterial`'s uniforms, which three types as any name of any value). */
type ValueOf<Key, K, C, N, Colour> = Key extends C ? (Key extends K ? N | Colour : Colour) : N

/**
 * A target for a scene's Subject, by its number keys `K` and its colour keys `C`: a transition, with an
 * entry under any of the keys `E`, which `animate`'s options are laid over field by field, and a
 * Transition end, set once the Subject lands.
 */
type SceneTarget<K extends string, C extends string, E extends string> = { readonly [Key in K | C]?: ValueOf<Key, K, C, SceneValue, ColourTargetValue> } & {
  /** How it gets there: a spring, a tween or an inertia, with an entry under any of its keys, a colour's or a channel's. */
  readonly transition?: Config.WardicTransitionFor<E> | undefined
  /**
   * Values set once it lands, with no animation, each under a key the Subject has and three can write:
   * one it lacks, or can't write (its `id`), is an error at the call, as a key it animates is. One it can
   * no longer set by then is reported and left as it is, and the rest are set.
   */
  readonly transitionEnd?: SceneTransitionEnd<K, C> | undefined
}

/** A scene's Subject's Transition end, by its number keys `K` and its colour keys `C`: a number or a colour each. */
type SceneTransitionEnd<K extends string, C extends string> = { readonly [Key in K | C]?: ValueOf<Key, K, C, number, ThreeColours.ColourValue> }

/**
 * The keys a transition for `T` takes an entry under, each key a target for it can give: a scene
 * object's or a material's scene keys and colours, a uniforms object's uniforms, any other object's own
 * keys. A colour's entry runs its channels, and a channel's own entry runs it in place of its colour's.
 */
// #952: ThreeColours.splitCall gives a colour's entry to each of its channels without one of its own.
type TransitionKey<T> = [SceneKey<T>] extends [never] ? WardicObject.AnimatableKey<T> | UniformKey<T> | UniformColourKey<T> : SceneKey<T> | ColourKey<T>

/**
 * A target for `T`: a scene object's or a material's by its scene keys and colours; a uniforms object's
 * by its uniforms' names; any other object's (a `Vector3`, a plain `{ x }`) by its own keys, as `@wardic/object`'s.
 * Its transition takes an entry under any of them, a colour's or a channel's. An array has none that
 * fits: `animate` reads one as a list of Subjects, or a sequence, never as one Subject.
 */
// #963: an array's is `@wardic/object`'s, which nothing fits.
export type ThreeTarget<T> = [T] extends [ReadonlyArray<unknown>]
  ? WardicObject.ObjectTarget<T>
  : [SceneKey<T>] extends [never]
    ? Omit<WardicObject.ObjectTarget<T>, "transition"> & SceneTarget<UniformKey<T>, UniformColourKey<T>, TransitionKey<T>>
    : SceneTarget<SceneKey<T>, ColourKey<T>, TransitionKey<T>>

/**
 * A target for `T` whose keys are any name (a `ShaderMaterial`'s uniforms, a mesh drawn with one), checked
 * key by key as given (`G`): `transition` as a transition, `transitionEnd` as its Transition end, and any
 * other key as {@link ThreeTarget} gives it a value. Since any name is one of its keys, a misspelt key,
 * even a scene object's own (`rotatY`), isn't caught.
 */
// #958: three types a ShaderMaterial's `uniforms` as any name, so a ThreeTarget's keys are an index
// signature, and `transition` and `transitionEnd` would have to be values too.
type AnyKeyTarget<T, G> = {
  readonly [P in keyof G]: P extends "transition"
    ? Config.WardicTransitionFor<string> | undefined
    : P extends "transitionEnd"
      ? AnyKeyTransitionEnd<T> | undefined
      : AnyKeyValue<T, P & string>
}

/** The value a target for `T`, whose keys are any name, gives its key `P`: a scene's by its keys and colours, any other object's by its own keys and its uniforms'. */
// #964: any other object's own keys as `@wardic/object`'s target gives them, an optional key's value
// without its `undefined`. Its `transition` and `transitionEnd` are keys too, which AnyKeyTarget takes first.
type AnyKeyValue<T, P extends string> = [SceneKey<T>] extends [never]
  ? (P extends keyof WardicObject.ObjectTarget<T> ? Exclude<WardicObject.ObjectTarget<T>[P], undefined> : never) | (P extends UniformKey<T> | UniformColourKey<T> ? ValueOf<P, UniformKey<T>, UniformColourKey<T>, SceneValue, ColourTargetValue> : never)
  : ValueOf<P, SceneKey<T>, ColourKey<T>, SceneValue, ColourTargetValue>

/** The Transition end of a target for `T` whose keys are any name, as {@link ThreeTarget}'s. */
// #964: any other object's as `@wardic/object`'s target gives it.
type AnyKeyTransitionEnd<T> = [SceneKey<T>] extends [never]
  ? (WardicObject.ObjectTarget<T> extends { readonly transitionEnd?: infer End } ? Exclude<End, undefined> : never) & SceneTransitionEnd<UniformKey<T>, UniformColourKey<T>>
  : SceneTransitionEnd<SceneKey<T>, ColourKey<T>>

/** Where `T`'s keys are any name, the target given, checked key by key ({@link AnyKeyTarget}); else nothing, a {@link ThreeTarget} its target. */
// Beside ThreeTarget<T>, not in place of it: a target typed as one, a wrapper's among them, still fits.
type AnyKeyTargetFor<T, G> = string extends TransitionKey<T> ? AnyKeyTarget<T, G> : never

/** An `InstancedMesh`, by its flag. */
type IsInstancedMesh = { readonly isInstancedMesh: true }

/** The keys a Batch of `T` takes: an `InstancedMesh`'s instance's, a scene object's scene keys, any other object's numbers. */
export type BatchKey<T> = T extends ThreeInstances.Instance<IsInstancedMesh> ? ThreeInstances.InstanceKey : [SceneKey<T>] extends [never] ? ObjectBatch.NumberKey<T> : SceneKey<T>

/** The colour keys a Batch of `T` takes: an instance's `color`, a scene object's colours. */
export type BatchColourKey<T> = T extends ThreeInstances.Instance<IsInstancedMesh> ? "color" : T extends { readonly isObject3D: true } ? ColourKey<T> : never

/** A Batch of a scene's objects, or of an `InstancedMesh`'s instances: one run for all of them. `@wardic/object`'s, on scene keys. */
export type ThreeBatch<T extends object> = ObjectBatch.ObjectBatch<T, BatchKey<T>>

/** A Batch's stop of a colour: one for every member, or a function of a member's index and the count. */
type ColourStop = ThreeColours.ColourValue | ((i: number, n: number) => ThreeColours.ColourValue)

/** A Batch's value for a number key: a stop, two (its first and its target), or a function giving them. `@wardic/object`'s. */
type BatchNumberValue = ObjectBatch.Stop | readonly [ObjectBatch.Stop, ObjectBatch.Stop] | ((i: number, n: number) => number | readonly [number, number])

/** A Batch's value for a colour key: a stop, two, or a function giving them. */
type BatchColourValue = ColourStop | readonly [ColourStop, ColourStop] | ((i: number, n: number) => ThreeColours.ColourValue | readonly [ThreeColours.ColourValue, ThreeColours.ColourValue])

/** A Batch of `T`'s targets for an `animate` call: each number key and colour key a stop, two, or a function of a member's index giving them. */
export type ThreeBatchTarget<T> = { readonly [Key in BatchKey<T> | BatchColourKey<T>]?: ValueOf<Key, BatchKey<T>, BatchColourKey<T>, BatchNumberValue, BatchColourValue> }

/** A Batch's colour key in a sequence's Segment of it: a colour, `null` for where it is, stops of them, or a function giving them. */
type ColourSegmentValue =
  | ThreeColours.ColourValue
  | null
  | ReadonlyArray<ThreeColours.ColourValue | null>
  | ((i: number, n: number) => ThreeColours.ColourValue | null | ReadonlyArray<ThreeColours.ColourValue | null>)

/** A Segment of a Batch, `[batch, target, options?]`, its colour keys taking colours: every member, or a member's handle, `batch.at(i)`. */
export type ThreeBatchSegment =
  | readonly [batch: ObjectBatch.ObjectBatch<any, any> | ObjectBatch.Member<any, any>, target: Readonly<Record<string, ObjectBatch.SegmentValue | ColourSegmentValue>>]
  | readonly [batch: ObjectBatch.ObjectBatch<any, any> | ObjectBatch.Member<any, any>, target: Readonly<Record<string, ObjectBatch.SegmentValue | ColourSegmentValue>>, options: Imperative.WardicSegmentOptions]

/** A sequence of a scene: `@wardic/object`'s Segments, its Segments of Batches taking colours. Motion's `AnimationSequence`. */
export type ThreeSequence = ReadonlyArray<WardicObject.ObjectSequence[number] | ThreeBatchSegment>

/**
 * `animate(subject, target, options?)` animates a scene's Subject, or each of a list of them, to
 * `target`; `animate(sequence, options?)` plays a sequence. Either returns its Playback controls. Motion's.
 * The options' transition takes an entry under any of the Subject's keys: a Batch's, its keys.
 * A Subject whose keys are any name (a `ShaderMaterial`, a mesh drawn with one) has its target checked
 * key by key as given, though a misspelt key, even a mesh's own (`rotatY`), isn't caught, any name being
 * one of its keys; naming its type, `animate<T>(…)`, checks its keys as values only.
 */
export interface ThreeAnimate {
  <T extends object>(batch: ThreeBatch<T> | ObjectBatch.Member<T, BatchKey<T>>, target: ThreeBatchTarget<T>, options?: Imperative.WardicAnimateOptionsFor<BatchKey<T> | BatchColourKey<T>>): Imperative.WardicPlaybackControls
  // #959: a Subject whose type is assignable to a string record (an object literal's, an index
  // signature's: a ShaderMaterial's `uniforms`, a Record), its type inferred from it alone. Through
  // `T | ReadonlyArray<T>`, an index signature reads as a list's members, and `T` falls back to
  // `object`. Classes (meshes, materials) and arrays aren't string records, so they take the last
  // signature, as before.
  <T extends Readonly<Record<string, unknown>>, const G extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>(
    subject: T,
    target: ThreeTarget<T> | AnyKeyTargetFor<T, G>,
    options?: Imperative.WardicAnimateOptionsFor<TransitionKey<T>>,
  ): Imperative.WardicPlaybackControls
  (sequence: ThreeSequence, options?: Imperative.WardicSequenceOptions): Imperative.WardicPlaybackControls
  // Last, since past three overloads TypeScript reports only the last one's error: a Subject's target
  // misspelt names its key, rather than "not a sequence".
  <T extends object, const G extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>(
    subject: T | ReadonlyArray<T>,
    target: ThreeTarget<T> | AnyKeyTargetFor<T, G>,
    options?: Imperative.WardicAnimateOptionsFor<TransitionKey<T>>,
  ): Imperative.WardicPlaybackControls
}

/** A runtime's options: `@wardic/object`'s, the scene's unit scale, and its input. */
export interface Options extends WardicObject.Options {
  /**
   * How many of Motion's units a metre is, for `x`, `y` and `z`'s springs' rest: 100 (a scene in
   * metres), so a 10 m move rests within 5 mm. Give 1 for a scene in pixels.
   */
  readonly unitScale?: number | undefined
  /** The canvas the scene is drawn on, whose pointer events `hover` and `press` hear: with `camera` and `scene`. */
  readonly canvas?: ThreeInput.CanvasLike | undefined
  /** The camera the scene is drawn with, or a function giving the one active now: a pointer's ray is cast from it. */
  readonly camera?: Camera | (() => Camera) | undefined
  /** The scene a pointer hits. */
  readonly scene?: Object3D | undefined
  /** What a pointer hits, in the raycast's place: a BVH's, or a GPU pick's. */
  readonly hitTest?: ThreeInput.HitTest | undefined
  /** Where a held pointer's events are heard once it leaves the canvas: the canvas's window when left out. */
  readonly window?: EventTarget | undefined
}

/**
 * `batch(objects, options?)` makes a Batch of a list of objects; `batch(instanced, options?)` one of an
 * `InstancedMesh`'s instances, a member each. Either runs on the keys of its first `animate` (or `keys`).
 */
export interface ThreeBatchOf {
  <M extends IsInstancedMesh>(instanced: M, options?: ObjectBatch.Options<ThreeInstances.Instance<M>, ThreeInstances.InstanceKey | "color">): ThreeBatch<ThreeInstances.Instance<M>>
  <T extends object>(objects: ReadonlyArray<T>, options?: ObjectBatch.Options<T, BatchKey<T> | BatchColourKey<T>>): ThreeBatch<T>
}

/** A runtime: what animates a scene on one Host loop. */
export interface WardicThree extends Omit<WardicObject.WardicObject, "animate" | "batch"> {
  readonly animate: ThreeAnimate
  /**
   * A Batch of `objects`, or of an `InstancedMesh`'s instances: one run for all of them, on the keys of
   * its first `animate` (or `keys`). `animate(batch, target)` moves every member; `animate(batch.at(i),
   * target)` member `i`. An instance takes its transforms and its colour.
   */
  readonly batch: ThreeBatchOf
  /**
   * `hover(subject, onStart)`: `onStart` runs as a pointer comes over `subject` (a scene object, a Batch's
   * member, or each member of a Batch), and what it returns, as the pointer goes off. Returns its cancel.
   * Needs `make`'s `canvas`, `camera` and `scene`.
   */
  readonly hover: (subject: object, onStart: ThreeInput.HoverStart) => () => void
  /**
   * `press(subject, onStart)`: `onStart` runs as a press starts on `subject`, and what it returns, as it
   * ends, told whether it ended on it. Returns its cancel. Needs `make`'s `canvas`, `camera` and `scene`.
   */
  readonly press: (subject: object, onStart: ThreeInput.PressStart) => () => void
  /**
   * The scene's pointer input, as core's `InputSource`, for a binding's gestures: `undefined` with no
   * canvas. Unstable: what `@wardic/three/solid`'s Stage hands its hooks.
   */
  // #885's PR 1 (ADR-0073, *Amendment (#885)*, Q3): a Stage adopting a runtime made outside Solid reads it.
  readonly input: InputSource.InputSource["Service"] | undefined
}

/** A scene's unit scale when the app gives none: a metre counts as 100 of Motion's units. */
// ADR-0069 decision 8.
export const UNIT_SCALE = 100

/** three's Environment for `@wardic/object`'s runtime, at `unitScale`. */
export const environment = (unitScale: number = UNIT_SCALE): WardicObject.Environment => ({
  renderer: ThreeRenderer.layer,
  gate: ThreeRenderer.GATE,
  startLinksOf: ThreeValues.startLinksOf,
  ownValues: ObjectValues.ownValues,
  positionalKeys: ThreeValues.positionalKeys,
  batchWriter: ThreeRenderer.writer,
  batchRead: ThreeValues.read,
  batchSource: ThreeInstances.batchSource(),
  layers: UnitScale.layerWith(ThreeColours.unitScale(unitScale)),
})

/** A Segment of a sequence with its colour keys split: a Segment of a Subject or of a Batch, `[subject, target, options?]`; any other as it is. */
const splitSegment = (segment: unknown): unknown => {
  if (!Arr.isArray(segment)) return segment
  const [subject, target, options] = segment as ReadonlyArray<unknown>
  if (Predicate.isFunction(subject)) return segment
  const [split, splitOptions] = ThreeColours.splitCall(subjectOf(subject), target, options)
  if (split === target && splitOptions === options) return segment
  if (segment.length < 3) return [subject, split]
  return [subject, split, splitOptions]
}

/** A Batch's handle, or a member's, as a call names it. */
interface BatchHandle {
  readonly members?: ReadonlyArray<object>
  readonly i?: number
  readonly batch?: { readonly members: ReadonlyArray<object> }
}

/** A Batch's member a call's colours are read by: a member handle's own, else the Batch's first. */
const memberOf = (handle: BatchHandle): unknown => {
  if (Predicate.isNumber(handle.i) && Predicate.isNotUndefined(handle.batch)) return handle.batch.members[handle.i]
  return UndefinedOr.match(handle.members, { onUndefined: constUndefined, onDefined: (members) => members[0] })
}

/** The Subject a call's target is read for: a Batch's member, the first of a list, or the Subject itself. */
const subjectOf = (subject: unknown): unknown => {
  if (Predicate.isNotUndefined(ObjectBatch.entryOf(subject))) return memberOf(subject as BatchHandle)
  if (Arr.isArray(subject)) return (subject as ReadonlyArray<unknown>)[0]
  return subject
}

/** `animate` with each colour key split into its channels at the call, for a Subject, a list of them, a Batch, or a sequence's Segments of them. */
const withColours = (animate: (first: unknown, second?: unknown, third?: unknown) => Imperative.WardicPlaybackControls) =>
  (first: unknown, second?: unknown, third?: unknown): Imperative.WardicPlaybackControls => {
    if (Imperative.isSequence(first)) return animate(Arr.map(first, splitSegment), second)
    const [split, options] = ThreeColours.splitCall(subjectOf(first), second, third)
    return animate(first, split, options)
  }

/** `batch` with each colour key in its `keys` given as its channels. */
const withChannelKeys = (batch: (given: unknown, options?: ObjectBatch.Options<object, string>) => unknown) =>
  (given: unknown, options?: ObjectBatch.Options<object, string>): unknown => {
    if (Predicate.isUndefined(options) || Predicate.isUndefined(options.keys)) return batch(given, options)
    return batch(given, { ...options, keys: ThreeColours.splitBatchKeys(given, options.keys) })
  }

/** The scene's input `options` give: `undefined` without a canvas, an error naming what's missing with one. */
const inputOf = (options: Options): ThreeInput.SceneInput | undefined => {
  const { canvas, camera, scene } = options
  if (Predicate.isUndefined(canvas)) return undefined
  if (Predicate.isUndefined(camera) || Predicate.isUndefined(scene)) {
    throw new Error("WardicThree.make: a canvas's input needs its camera and its scene too, to cast a pointer's ray: make({ canvas, camera, scene }).")
  }
  return ThreeInput.make({ canvas, camera, scene, hitTest: options.hitTest, window: options.window })
}

/** A gesture's call on a runtime with no input: an error naming the options it needs. */
const noInput = (name: string) => (): never => {
  throw new Error(`wardic.${name}: this runtime has no scene input. Give make the canvas the scene is drawn on, its camera and the scene: WardicThree.make({ canvas: renderer.domElement, camera, scene }).`)
}

/** A runtime on frames the Host loop pumps: `frame(time)` once a frame, before it renders. */
export const make = (options: Options = {}): WardicThree => {
  const unitScale = UndefinedOr.match(options.unitScale, { onUndefined: () => UNIT_SCALE, onDefined: (given) => given })
  const runtime = WardicObject.makeWith(environment(unitScale), options)
  const input = inputOf(options)
  if (Predicate.isUndefined(input)) {
    return {
      animate: withColours(runtime.animate as never) as unknown as ThreeAnimate,
      batch: withChannelKeys(runtime.batch as never) as unknown as ThreeBatchOf,
      afterWrites: runtime.afterWrites,
      frame: runtime.frame,
      wantsFrame: runtime.wantsFrame,
      dispose: runtime.dispose,
      stageEnvironment: runtime.stageEnvironment,
      hover: noInput("hover"),
      press: noInput("press"),
      input: undefined,
    }
  }
  return {
    animate: withColours(runtime.animate as never) as unknown as ThreeAnimate,
    batch: withChannelKeys(runtime.batch as never) as unknown as ThreeBatchOf,
    afterWrites: runtime.afterWrites,
    // The raycast first, against what was last drawn, then Wardic's writes.
    frame: (time) => {
      input.frame()
      runtime.frame(time)
    },
    wantsFrame: () => runtime.wantsFrame() || input.wantsFrame(),
    dispose: () => {
      input.dispose()
      runtime.dispose()
    },
    stageEnvironment: runtime.stageEnvironment,
    hover: input.hover,
    press: input.press,
    input: input.source,
  }
}
