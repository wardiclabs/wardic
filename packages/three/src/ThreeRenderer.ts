/**
 * The scene writer: Wardic's values written onto three.js objects once a frame, in the frame that
 * computed them. A scene object's transform keys go in one call per vector:
 * - `x`, `y` and `z` as `position.set`;
 * - `rotateX`, `rotateY` and `rotateZ`, in degrees, as one `rotation.set` in radians;
 * - `scale`, and `scaleX`, `scaleY` and `scaleZ`, as one `scale.set`, an axis's own key over `scale`.
 *
 * Any other key goes where the lookup finds it: the object's own number, its material's (each of an
 * array of them), a uniform's `value`, a TSL uniform node's, or a vector's axis. Two of three's own
 * rules follow a write: a camera's projection keys end with `updateProjectionMatrix()`, and a
 * material's `opacity` below 1 draws it transparent. `layer` is what `WardicThree` provides; `GATE` is what its
 * Flush gate reads of an object; `writer` draws a Batch of objects.
 *
 * @example
 * import * as ThreeRenderer from "@wardic/three/ThreeRenderer"
 *
 * ThreeRenderer.commit(mesh, { x: 2, rotateY: 90, opacity: 0.5 })
 * // mesh.position.x === 2, mesh.rotation.y === Math.PI / 2, mesh.material.opacity === 0.5
 */
// `@wardic/three/ThreeRenderer` (#883; ADR-0069 decisions 4–6, ADR-0073 *Amendment (#883)*, Q3): core's
// `Renderer`, as `@wardic/object/ObjectRenderer` is for plain objects. P3 measured one `rotation.set` a
// commit 2.4–2.9× cheaper than three's setters (ADR-0069 decision 6). Per frame: plain code.
import type * as Batch from "@wardic/core/Batch"
import * as Renderer from "@wardic/core/Renderer"
import type * as FlushGate from "@wardic/core/unstable/FlushGate"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Lookup from "./internal/lookup.ts"

/** Any object Wardic writes. */
type Holder = Record<string, unknown>

/** A vector three gives a scene object: `position`, `rotation` and `scale` are each set in one call. */
interface Settable {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly set: (x: number, y: number, z: number) => unknown
}

/**
 * What the gate saves of a property before its first write, to put back if the key ever drops out:
 * nothing. A scene's values stay where Wardic leaves them, so a commit skips a key given this.
 */
const NOTHING_SAVED = ""

/** A camera's projection keys: after one, its projection matrix is worked out again. */
const PROJECTION: ReadonlySet<string> = new Set(["fov", "zoom", "near", "far", "aspect", "left", "right", "top", "bottom"])

/** `value` as an axis's number, `NaN` where it's none: a key the patch doesn't give, or one put back with nothing. */
const axisOf = (value: unknown): number => {
  if (Predicate.isNumber(value)) return value
  return Number.NaN
}

/** `given` unless it's `NaN`, else `current`. */
const or = (given: number, current: number): number => {
  if (Number.isNaN(given)) return current
  return given
}

/** An axis's scale: its own key, else `scale`, else as it is. */
const scaleOr = (axis: number, all: number, current: number): number => {
  if (!Number.isNaN(axis)) return axis
  if (!Number.isNaN(all)) return all
  return current
}

/** Whether any of three axes is given. */
const anyOf = (a: number, b: number, c: number): boolean => !Number.isNaN(a) || !Number.isNaN(b) || !Number.isNaN(c)

/**
 * A scene object's transforms written, `NaN` for a key not given: one `position.set`, one `rotation.set`
 * from degrees, one `scale.set`, each only where one of its keys is given, the rest of its axes kept.
 */
export const writeTransforms = (object: Holder, x: number, y: number, z: number, rx: number, ry: number, rz: number, s: number, sx: number, sy: number, sz: number): void => {
  if (anyOf(x, y, z)) {
    const position = object.position as Settable
    position.set(or(x, position.x), or(y, position.y), or(z, position.z))
  }
  if (anyOf(rx, ry, rz)) {
    const rotation = object.rotation as Settable
    const radians = Lookup.RADIANS
    rotation.set(or(rx * radians, rotation.x), or(ry * radians, rotation.y), or(rz * radians, rotation.z))
  }
  if (anyOf(sx, sy, sz) || !Number.isNaN(s)) {
    const scale = object.scale as Settable
    scale.set(scaleOr(sx, s, scale.x), scaleOr(sy, s, scale.y), scaleOr(sz, s, scale.z))
  }
}

/** A scene's patch: its values as they are; the commit groups them. */
export const project = (values: Readonly<Record<string, unknown>>): Renderer.Patch => values as Renderer.Patch

/** `patch` written onto `target`: a scene object's transforms grouped, every other key where the lookup finds it. */
export const commit = (target: unknown, patch: Renderer.Patch): void => {
  const object = target as Holder
  const scene = Lookup.isObject3D(object)
  if (scene) {
    writeTransforms(object, axisOf(patch.x), axisOf(patch.y), axisOf(patch.z), axisOf(patch.rotateX), axisOf(patch.rotateY), axisOf(patch.rotateZ), axisOf(patch.scale), axisOf(patch.scaleX), axisOf(patch.scaleY), axisOf(patch.scaleZ))
  }
  let projection = false
  for (const key in patch) {
    const value = patch[key]
    if (value === NOTHING_SAVED) continue
    if (scene && Lookup.isTransformKey(key)) continue
    Lookup.write(object, key, value)
    if (PROJECTION.has(key)) projection = true
  }
  if (projection && object.isCamera === true && Predicate.isFunction(object.updateProjectionMatrix)) (object as { readonly updateProjectionMatrix: () => void }).updateProjectionMatrix()
}

/** The Flush gate's reads of an object: nothing saved before a write, and a template key no object has. */
export const GATE: FlushGate.GateEnvironment = { valueBeforeOf: () => NOTHING_SAVED, templateKey: "@wardic/three/template" }

/** The scene writer as the Environment's `Renderer`. */
export const layer: Layer.Layer<Renderer.Renderer> = /*#__PURE__*/ Layer.succeed(Renderer.Renderer, { project, commit })

/** Where `key` is in a Batch's keys, `-1` where it isn't. */
const indexIn = (keys: ReadonlyArray<string>, key: string): number => keys.indexOf(key)

/** A Batch's position for key index `k` of a member, `NaN` for a key it doesn't have. */
const at = (positions: Float64Array, base: number, k: number): number => {
  if (k < 0) return Number.NaN
  return positions[base + k]
}

/**
 * The scene writer for a Batch of objects: each member's transforms grouped as
 * the commit's are, any other key where the lookup finds it. Its keys' places are found once, by index.
 */
// ADR-0069 decision 11.
export const writer: Batch.Writer<object> = {
  writes: () => true,
  forKeys: (keys) => {
    const ix = indexIn(keys, "x")
    const iy = indexIn(keys, "y")
    const iz = indexIn(keys, "z")
    const irx = indexIn(keys, "rotateX")
    const iry = indexIn(keys, "rotateY")
    const irz = indexIn(keys, "rotateZ")
    const is = indexIn(keys, "scale")
    const isx = indexIn(keys, "scaleX")
    const isy = indexIn(keys, "scaleY")
    const isz = indexIn(keys, "scaleZ")
    return (subject, positions, base) => {
      const object = subject as Holder
      const scene = Lookup.isObject3D(object)
      if (scene) {
        writeTransforms(object, at(positions, base, ix), at(positions, base, iy), at(positions, base, iz), at(positions, base, irx), at(positions, base, iry), at(positions, base, irz), at(positions, base, is), at(positions, base, isx), at(positions, base, isy), at(positions, base, isz))
      }
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k]
        if (scene && Lookup.isTransformKey(key)) continue
        Lookup.write(object, key, positions[base + k])
      }
    }
  },
}
