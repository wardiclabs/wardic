/**
 * Where a key a three.js Subject animates lives, read and written alike: a scene object's transform
 * keys on its `position`, `rotation` (in degrees) and `scale`; any other key the Subject's own number,
 * else found on its material, its uniforms or a vector's axis, as Motion's `motion/three` finds it.
 *
 * @internal
 */
// `@wardic/three`'s lookup (#883; ADR-0069 decisions 4–6, ADR-0073 decision 23 and *Amendment (#883)*, Q3).
// A key's place is found once per Subject and kept, so a frame's write allocates nothing; it's found
// again once the Subject's material changes. Plain code: the writer calls it per frame.
import { DEV } from "@wardic/three/internal/dev"
import * as Predicate from "effect/Predicate"
import * as SharedMaterial from "./shared-material.ts"

/** Any object Wardic reads a key of. */
type Holder = Record<string, unknown>

/** Degrees to radians: a rotation's keys are in degrees, three's `rotation` in radians. */
export const RADIANS = Math.PI / 180

/** The transform keys a scene object takes (ADR-0069 decision 4): written as its position, rotation and scale. */
const TRANSFORMS: ReadonlySet<string> = new Set(["x", "y", "z", "rotateX", "rotateY", "rotateZ", "scale", "scaleX", "scaleY", "scaleZ"])

/** Whether `key` is a scene object's transform key. */
export const isTransformKey = (key: string): boolean => TRANSFORMS.has(key)

/** Whether `subject` is a scene object: three's `Object3D`, by its flag (ADR-0069 decision 3). */
export const isObject3D = (subject: unknown): boolean => Predicate.isObject(subject) && (subject as Holder).isObject3D === true

/** Whether `holder` is a material, by its flag. */
export const isMaterial = (holder: unknown): boolean => Predicate.isObject(holder) && (holder as Holder).isMaterial === true

/** Whether `value` is a uniform: an object holding a `value`, a `ShaderMaterial`'s or a bare uniforms object's. */
const isUniform = (value: unknown): value is { value: unknown } => Predicate.isObject(value) && "value" in value

/** Whether `value` is a key's value Wardic animates: a number, or a string. */
const isAnimatable = (value: unknown): value is number | string => Predicate.isNumber(value) || Predicate.isString(value)

/** The materials `subject` draws with: its `material`, or each of an array of them. None for a Subject without one. */
export const materialsOf = (subject: Holder): ReadonlyArray<Holder> => {
  const material = subject.material
  if (Array.isArray(material)) return material.filter(isMaterial) as ReadonlyArray<Holder>
  if (isMaterial(material)) return [material as Holder]
  return []
}

/** Where a key is written: each holder's own property, by its name, in parallel lists. */
export interface Place {
  readonly holders: ReadonlyArray<Holder>
  readonly props: ReadonlyArray<string>
  /** The Subject's `material` the place was found under: found again once it changes. */
  readonly material: unknown
}

/** A key at `holder` itself: a TSL uniform node set for it (three draws the node over the property), its number, or a uniform it names. */
const atHolder = (holder: Holder, key: string): readonly [Holder, string] | undefined => {
  const node = holder[`${key}Node`]
  if (Predicate.isObject(node) && (node as Holder).isUniformNode === true) return [node as Holder, "value"]
  const own = holder[key]
  if (isAnimatable(own)) return [holder, key]
  if (isUniform(own) && isAnimatable(own.value)) return [own as Holder, "value"]
  return undefined
}

/** A key among `uniforms`: the uniform of its name. */
const inUniforms = (uniforms: unknown, key: string): readonly [Holder, string] | undefined => {
  if (!Predicate.isObject(uniforms)) return undefined
  const uniform = (uniforms as Holder)[key]
  if (isUniform(uniform) && isAnimatable(uniform.value)) return [uniform as Holder, "value"]
  return undefined
}

/** The axes a vector key may end in, `positionX` is `position.x`, and a colour's channels, `colorR` is `color.r`. */
const AXES: Readonly<Record<string, string>> = { X: "x", Y: "y", Z: "z", W: "w", R: "r", G: "g", B: "b" }

/**
 * A key as a vector's axis or a colour's channel at `holder`, `normalScaleX` → `holder.normalScale.x`,
 * `colorR` → `holder.color.r`, or a uniform's, `uOffsetX` → `uniforms.uOffset.value.x`.
 */
const asAxis = (holder: Holder, key: string): readonly [Holder, string] | undefined => {
  const axis = AXES[key.slice(-1)]
  if (Predicate.isUndefined(axis)) return undefined
  const base = key.slice(0, -1)
  const vector = holder[base]
  if (Predicate.isObject(vector) && Predicate.isNumber((vector as Holder)[axis])) return [vector as Holder, axis]
  // A bare uniforms object's: `uSkyR` → `uniforms.uSky.value.r`.
  if (isUniform(vector) && Predicate.isObject(vector.value) && Predicate.isNumber((vector.value as Holder)[axis])) return [vector.value as Holder, axis]
  const uniforms = holder.uniforms
  if (!Predicate.isObject(uniforms)) return undefined
  const uniform = (uniforms as Holder)[base]
  if (!isUniform(uniform)) return undefined
  const value = uniform.value
  if (Predicate.isObject(value) && Predicate.isNumber((value as Holder)[axis])) return [value as Holder, axis]
  return undefined
}

/** A place on each holder that has the key one way: the materials of an array, each that has it. */
const placeIn = (holders: ReadonlyArray<Holder>, find: (holder: Holder, key: string) => readonly [Holder, string] | undefined, key: string, material: unknown): Place | undefined => {
  const found: Array<Holder> = []
  const props: Array<string> = []
  for (const holder of holders) {
    const at = find(holder, key)
    if (Predicate.isUndefined(at)) continue
    found.push(at[0])
    props.push(at[1])
  }
  if (found.length === 0) return undefined
  return { holders: found, props, material }
}

/**
 * Where `key` lives on `subject`, in Motion's order: the Subject itself (a TSL uniform node, its number,
 * a uniform it names), then its material's (each of an array of them), then its uniforms', then a vector's
 * axis. `undefined` where it's nowhere. Not the transform keys of a scene object: they're its own.
 */
const find = (subject: Holder, key: string): Place | undefined => {
  const material = subject.material
  const own = placeIn([subject], atHolder, key, material)
  if (Predicate.isNotUndefined(own)) return own
  const materials = materialsOf(subject)
  const onMaterial = placeIn(materials, atHolder, key, material)
  if (Predicate.isNotUndefined(onMaterial)) {
    if (DEV) SharedMaterial.check(subject, key, materials)
    return onMaterial
  }
  const uniforms = placeIn([subject, ...materials], (holder, name) => inUniforms(holder.uniforms, name), key, material)
  if (Predicate.isNotUndefined(uniforms)) return uniforms
  const axis = placeIn([subject], asAxis, key, material)
  if (Predicate.isNotUndefined(axis)) return axis
  return placeIn(materials, asAxis, key, material)
}

/** Whether `value` is a three `Color`, by its flag. */
const isColor = (value: unknown): boolean => Predicate.isObject(value) && (value as Holder).isColor === true

/** The Color at `holder`'s `key`: its own, or a uniform's value it names. */
const colourAt = (holder: Holder, key: string): Holder | undefined => {
  const own = holder[key]
  if (isColor(own)) return own as Holder
  // A bare uniforms object's.
  if (isUniform(own) && isColor(own.value)) return own.value as Holder
  const uniforms = holder.uniforms
  if (!Predicate.isObject(uniforms)) return undefined
  const uniform = (uniforms as Holder)[key]
  if (isUniform(uniform) && isColor(uniform.value)) return uniform.value as Holder
  return undefined
}

/** The Color `key` names on `subject`: its own, else its material's (the first of an array that has one), its own uniform's or its material's. */
export const colourOf = (subject: object, key: string): Holder | undefined => {
  const holder = subject as Holder
  const own = colourAt(holder, key)
  if (Predicate.isNotUndefined(own)) return own
  for (const material of materialsOf(holder)) {
    const found = colourAt(material, key)
    if (Predicate.isNotUndefined(found)) return found
  }
  return undefined
}

/** Each Subject's places, by key, as found. */
// Module state: held weakly by the Subject, so it goes with it.
const PLACES = new WeakMap<object, Map<string, Place>>()

/** Where `key` lives on `subject`, kept until its material changes. */
export const placeOf = (subject: Holder, key: string): Place | undefined => {
  let places = PLACES.get(subject)
  if (Predicate.isUndefined(places)) {
    places = new Map()
    PLACES.set(subject, places)
  }
  const kept = places.get(key)
  if (Predicate.isNotUndefined(kept) && kept.material === subject.material) return kept
  const found = find(subject, key)
  if (Predicate.isUndefined(found)) {
    places.delete(key)
    return undefined
  }
  places.set(key, found)
  return found
}

/** Where a transform key is read on a scene object: its vector, its axis, and its unit (degrees for a rotation). */
const TRANSFORM_READS: Readonly<Record<string, readonly [vector: string, axis: string, per: number]>> = {
  x: ["position", "x", 1],
  y: ["position", "y", 1],
  z: ["position", "z", 1],
  rotateX: ["rotation", "x", RADIANS],
  rotateY: ["rotation", "y", RADIANS],
  rotateZ: ["rotation", "z", RADIANS],
  // `scale` is its `x`, as Motion's.
  scale: ["scale", "x", 1],
  scaleX: ["scale", "x", 1],
  scaleY: ["scale", "y", 1],
  scaleZ: ["scale", "z", 1],
}

/** A scene object's transform key, read from its position, rotation in degrees, or scale. */
const readTransform = (subject: Holder, key: string): number => {
  const [vector, axis, per] = TRANSFORM_READS[key]
  return ((subject[vector] as Holder)[axis] as number) / per
}

/** `subject`'s value for `key` now, where the lookup finds it: `undefined` where it's nowhere. */
export const read = (subject: object, key: string): unknown => {
  const holder = subject as Holder
  if (isObject3D(holder) && isTransformKey(key)) return readTransform(holder, key)
  const place = placeOf(holder, key)
  if (Predicate.isUndefined(place)) return undefined
  return place.holders[0][place.props[0]]
}

/** Materials whose `transparent` Wardic set, so it puts it back once their opacity is 1 again. */
// Module state: held weakly by the material.
const MADE_TRANSPARENT = new WeakSet<object>()

/**
 * three's rule after `opacity` on a material: below 1 it's drawn transparent, and once it's back at 1
 * Wardic puts back the `transparent` it set. `needsUpdate` only on a flip, which recompiles it.
 */
const ruleOpacity = (material: Holder, opacity: unknown): void => {
  if (!Predicate.isNumber(opacity)) return
  if (opacity < 1) {
    if (material.transparent === true) return
    material.transparent = true
    material.needsUpdate = true
    MADE_TRANSPARENT.add(material)
    return
  }
  if (!MADE_TRANSPARENT.has(material)) return
  MADE_TRANSPARENT.delete(material)
  material.transparent = false
  material.needsUpdate = true
}

/** `value` written to `key` on `subject`, where the lookup finds it, with `opacity`'s rule after it: nowhere, nothing written. */
export const write = (subject: Holder, key: string, value: unknown): void => {
  const place = placeOf(subject, key)
  if (Predicate.isUndefined(place)) return
  const holders = place.holders
  const props = place.props
  for (let i = 0; i < holders.length; i++) {
    const holder = holders[i]
    holder[props[i]] = value
    if (key === "opacity" && holder.isMaterial === true) ruleOpacity(holder, value)
  }
}
