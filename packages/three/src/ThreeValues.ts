/**
 * A three.js Subject's values for Wardic: where each key it animates starts, found where the writer
 * writes it (a scene object's transforms, its own number, its material's, a uniform's, a TSL uniform
 * node's, a vector's axis), and the scene's Positional keys. A key found nowhere, or whose value isn't
 * a number or a string, is an error naming it: Wardic adds no property to a scene.
 *
 * @example
 * import * as ThreeValues from "@wardic/three/ThreeValues"
 *
 * ThreeValues.read(mesh, "rotateY") // its rotation.y, in degrees
 * ThreeValues.read(mesh, "opacity") // mesh.material.opacity
 */
// `@wardic/three/ThreeValues` (#883; ADR-0069 decisions 4, 5 and 9, ADR-0073 *Amendment (#883)*, Q3):
// `@wardic/object`'s start links on three's lookup.
import * as ObjectValues from "@wardic/object/ObjectValues"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as Spine from "@wardic/core/unstable/Spine"
import * as Arr from "effect/Array"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Lookup from "./internal/lookup.ts"

/** Any object of a scene. */
type Holder = Record<string, unknown>

/** What `subject` is called in an error: its `name`, else its type's, else "the object". */
const nameOf = (subject: object): string => {
  const holder = subject as Holder
  if (Predicate.isString(holder.name) && holder.name !== "") return `"${holder.name}"`
  if (Predicate.isString(holder.type)) return `a ${holder.type}`
  return "the object"
}

/** Whether `holder`'s `key` is a three `Color`. */
const isColorAt = (holder: unknown, key: string): boolean => Predicate.isObject(holder) && Predicate.isObject((holder as Holder)[key]) && ((holder as Holder)[key] as Holder).isColor === true

/** Whether `key` is a `Color` on `subject` or its material. */
const isColorKey = (subject: object, key: string): boolean => isColorAt(subject, key) || Arr.some(Lookup.materialsOf(subject as Holder), (material) => isColorAt(material, key))

/**
 * `subject`'s value for `key` now, as a Batch reads a member's before it moves it: where the lookup finds
 * it, `undefined` where it's nowhere.
 */
export const read: (subject: object, key: string) => unknown = Lookup.read

/** `subject`'s own value for `key`, a number or a string, else an error naming the key. */
const ownValueOf = (subject: object, key: string): Option.Option<number | string> => {
  const value = Lookup.read(subject, key)
  if (Predicate.isNumber(value) || Predicate.isString(value)) return Option.some(value)
  if (isColorKey(subject, key)) {
    throw new Error(`wardic.animate: ${nameOf(subject)}'s "${key}" is a Color, which Wardic reads as a colour at the call: give it a colour, animate(mesh, { ${key}: "#ff8800" }), or its channels in linear light, ${key}R, ${key}G and ${key}B.`)
  }
  if (Predicate.isUndefined(value)) {
    throw new Error(`wardic.animate: ${nameOf(subject)} has no "${key}" to animate: not its own, nor its material's, nor a uniform's, nor a vector's axis (positionX). Give a key it has; Wardic adds no property to a scene.`)
  }
  throw new Error(`wardic.animate: ${nameOf(subject)}'s "${key}" is ${typeof value}, which can't be animated: a key's value is a number or a string.`)
}

/** `subject`'s Base-value links (ADR-0022): each key starts from its value where the lookup finds it. */
export const startLinksOf: (subject: object) => Spine.StartLinks = /*#__PURE__*/ ObjectValues.startLinksWith(ownValueOf)

/** Whether reduced motion snaps `key` in a scene: a transform key on any Subject, and a camera's `fov` and `zoom` (ADR-0069 decision 9). */
export const isPositional = (key: string): boolean => ReducedMotion.isTransform(key) || key === "fov" || key === "zoom"

/** A scene's Positional keys: the vestibular case is a camera's move as much as an object's. */
export const positionalKeys: Layer.Layer<ReducedMotion.PositionalKeys> = /*#__PURE__*/ Layer.succeed(ReducedMotion.PositionalKeys, { isPositional })
