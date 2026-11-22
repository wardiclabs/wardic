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
 * - **Units:** `x`, `y` and `z` are metres, so springs rest within millimetres (`unitScale`).
 * - **three's rules after a write:** a camera's projection keys update its projection matrix, and an
 *   `opacity` below 1 draws its material transparent.
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
// (`hover`, `press`, the raycast) is #883's PR 5 and `InstancedMesh` its PR 4; colours are PR 3's
// (`ThreeColours`), split at the call into their channels.
import * as UnitScale from "@wardic/core/UnitScale"
import type * as Config from "@wardic/core/unstable/Config"
import * as Imperative from "@wardic/core/unstable/Imperative"
import * as ObjectBatch from "@wardic/object/ObjectBatch"
import * as ObjectValues from "@wardic/object/ObjectValues"
import * as WardicObject from "@wardic/object/WardicObject"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as ThreeColours from "./ThreeColours.ts"
import * as ThreeRenderer from "./ThreeRenderer.ts"
import * as ThreeValues from "./ThreeValues.ts"

/** A scene object's transform keys (ADR-0069 decision 4): its position, its rotation in degrees, and its scales. */
export type TransformKey = "x" | "y" | "z" | "rotateX" | "rotateY" | "rotateZ" | "scale" | "scaleX" | "scaleY" | "scaleZ"

/** `T`'s keys that hold a number. */
type NumberKey<T> = { readonly [K in keyof T]-?: T[K] extends number ? K : never }[keyof T] & string

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

/** The names of `U`'s uniforms that hold a number, a vector's axes, or a colour's channels. */
type UniformKey<U> = {
  readonly [K in keyof U]-?: U[K] extends { value: number } ? K : U[K] extends { value: IsColor } ? (K extends string ? ChannelKey<K> : never) : U[K] extends { value: infer V } ? (K extends string ? `${K}${AxesOf<V>}` : never) : never
}[keyof U] & string

/** The names of `U`'s uniforms that hold a `Color`. */
type UniformColourKey<U> = { readonly [K in keyof U]-?: U[K] extends { value: IsColor } ? K : never }[keyof U] & string

/** The uniforms `M` holds, a `ShaderMaterial`'s. */
type UniformsOf<M> = M extends { readonly uniforms: infer U } ? U : never

/** The number keys of `M`, a material: its numbers, its vectors' axes, its colours' channels, and its uniforms'. */
type MaterialKey<M> = NumberKey<M> | VectorKey<M> | ChannelKey<ColourKeyOf<M>> | UniformKey<UniformsOf<M>>

/** The colour keys of `M`, a material: its `Color`s and its uniforms'. */
type MaterialColourKey<M> = ColourKeyOf<M> | UniformColourKey<UniformsOf<M>>

/** The material a mesh's `material` gives it: each of an array of them. */
type MaterialOf<T> = T extends { readonly material: infer M } ? (M extends ReadonlyArray<infer E> ? E : M) : never

/** The number keys of a three Subject `T`: a scene object's transforms, numbers and vectors' axes, and its material's; a material's own. */
export type SceneKey<T> = T extends { readonly isObject3D: true } ? TransformKey | NumberKey<T> | VectorKey<T> | MaterialKey<MaterialOf<T>> : T extends { readonly isMaterial: unknown } ? MaterialKey<T> : never

/** The colour keys of a three Subject `T`: its material's `Color`s for a scene object, a material's own, a uniforms object's. */
export type ColourKey<T> = T extends { readonly isObject3D: true } ? ColourKeyOf<T> | MaterialColourKey<MaterialOf<T>> : T extends { readonly isMaterial: unknown } ? MaterialColourKey<T> : UniformColourKey<T>

/** A key's value in a scene: a number, or keyframes of them. */
type SceneValue = number | Config.WardicKeyframes<number>

/** A colour key's value: a colour, or keyframes of them. */
type ColourTargetValue = ThreeColours.ColourValue | Config.WardicKeyframes<ThreeColours.ColourValue>

/** A key's value among number keys `K` and colour keys `C`: either, for a key in both (a `ShaderMaterial`'s uniforms, which three types as any name of any value). */
type ValueOf<Key, K, C, N, Colour> = Key extends C ? (Key extends K ? N | Colour : Colour) : N

/** A target for a scene's Subject, by its number keys `K` and its colour keys `C`. */
type SceneTarget<K extends string, C extends string> = { readonly [Key in K | C]?: ValueOf<Key, K, C, SceneValue, ColourTargetValue> } & {
  readonly transition?: Config.WardicTransition | undefined
  readonly transitionEnd?: { readonly [Key in K | C]?: ValueOf<Key, K, C, number, ThreeColours.ColourValue> } | undefined
}

/**
 * A target for `T`: a scene object's or a material's by its scene keys and colours; a uniforms object's
 * by its uniforms' names; any other object's (a `Vector3`, a plain `{ x }`) by its own keys, as `@wardic/object`'s.
 */
export type ThreeTarget<T> = [SceneKey<T>] extends [never] ? WardicObject.ObjectTarget<T> & SceneTarget<UniformKey<T>, UniformColourKey<T>> : SceneTarget<SceneKey<T>, ColourKey<T>>

/** The keys a Batch of `T` takes: a scene object's scene keys, any other object's numbers. */
export type BatchKey<T> = [SceneKey<T>] extends [never] ? ObjectBatch.NumberKey<T> : SceneKey<T>

/** A Batch of a scene's objects: one run for all of them. `@wardic/object`'s, on scene keys. */
export type ThreeBatch<T extends object> = ObjectBatch.ObjectBatch<T, BatchKey<T>>

/**
 * `animate(subject, target, options?)` animates a scene's Subject, or each of a list of them, to
 * `target`; `animate(sequence, options?)` plays a sequence. Either returns its Playback controls. Motion's.
 */
export interface ThreeAnimate {
  <T extends object>(batch: ThreeBatch<T> | ObjectBatch.Member<T, BatchKey<T>>, target: ObjectBatch.Target<T, BatchKey<T>>, options?: Imperative.WardicAnimateOptions): Imperative.WardicPlaybackControls
  <T extends object>(subject: T | ReadonlyArray<T>, target: ThreeTarget<T>, options?: Imperative.WardicAnimateOptions): Imperative.WardicPlaybackControls
  (sequence: WardicObject.ObjectSequence, options?: Imperative.WardicSequenceOptions): Imperative.WardicPlaybackControls
}

/** A runtime's options: `@wardic/object`'s, and the scene's unit scale. */
export interface Options extends WardicObject.Options {
  /**
   * How many of Motion's units a metre is, for `x`, `y` and `z`'s springs' rest: 100 (a scene in
   * metres), so a 10 m move rests within 5 mm. Give 1 for a scene in pixels.
   */
  readonly unitScale?: number | undefined
}

/** A runtime: what animates a scene on one Host loop. */
export interface WardicThree extends Omit<WardicObject.WardicObject, "animate" | "batch"> {
  readonly animate: ThreeAnimate
  /**
   * A Batch of `objects`: one run for all of them, on the keys of its first `animate` (or `keys`).
   * `animate(batch, target)` moves every member; `animate(batch.at(i), target)` member `i`.
   */
  readonly batch: <T extends object>(objects: ReadonlyArray<T>, options?: ObjectBatch.Options<T, BatchKey<T>>) => ThreeBatch<T>
}

/** A scene's unit scale when the app gives none: a metre counts as 100 of Motion's units (ADR-0069 decision 8). */
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
  layers: UnitScale.layerWith(ThreeColours.unitScale(unitScale)),
})

/** A Segment of a sequence with its colour keys split: a Segment of a Subject, `[subject, target, options?]`; any other as it is. */
const splitSegment = (segment: unknown): unknown => {
  if (!Arr.isArray(segment)) return segment
  const [subject, target, options] = segment as ReadonlyArray<unknown>
  if (Predicate.isNotUndefined(ObjectBatch.entryOf(subject)) || Predicate.isFunction(subject)) return segment
  const [split, splitOptions] = ThreeColours.splitCall(firstOf(subject), target, options)
  if (split === target) return segment
  if (segment.length < 3) return [subject, split]
  return [subject, split, splitOptions]
}

/** The Subject a call's target is read for: the first of a list. */
const firstOf = (subject: unknown): unknown => {
  if (Arr.isArray(subject)) return (subject as ReadonlyArray<unknown>)[0]
  return subject
}

/** `animate` with each colour key split into its channels at the call, for a Subject, a list of them, or a sequence's Segments of them. */
const withColours = (animate: (first: unknown, second?: unknown, third?: unknown) => Imperative.WardicPlaybackControls) =>
  (first: unknown, second?: unknown, third?: unknown): Imperative.WardicPlaybackControls => {
    if (Imperative.isSequence(first)) return animate(Arr.map(first, splitSegment), second)
    // A Batch's colours are its instances', with the `InstancedMesh` writer (PR 4).
    if (Predicate.isNotUndefined(ObjectBatch.entryOf(first))) return animate(first, second, third)
    const [split, options] = ThreeColours.splitCall(firstOf(first), second, third)
    return animate(first, split, options)
  }

/** A runtime on frames the Host loop pumps: `frame(time)` once a frame, before it renders. */
export const make = (options: Options = {}): WardicThree => {
  const unitScale = UndefinedOr.match(options.unitScale, { onUndefined: () => UNIT_SCALE, onDefined: (given) => given })
  const runtime = WardicObject.makeWith(environment(unitScale), options)
  return {
    animate: withColours(runtime.animate as never) as unknown as ThreeAnimate,
    batch: runtime.batch as unknown as WardicThree["batch"],
    afterWrites: runtime.afterWrites,
    frame: runtime.frame,
    wantsFrame: runtime.wantsFrame,
    dispose: runtime.dispose,
  }
}
