/**
 * An `InstancedMesh`'s instances as a Batch's members: `wardic.batch(instanced)` animates each
 * instance's transforms and colour by its index, as one run, where three would update an `Object3D` and
 * call `setMatrixAt` for each. The writer composes each moving instance's matrix in place, uploads only
 * the span of instances it wrote, and keeps the mesh's bounding sphere around them while they move, so
 * culling and the raycast stay right.
 *
 * - **Its members** are every instance the mesh holds, its capacity. Its `count`, how many are drawn,
 *   stays the app's.
 * - **Each starts** where its matrix puts it, read once when the Batch is made: its position, its
 *   rotation in degrees (Euler XYZ, three's default order) and its scale. A key the Batch doesn't take
 *   keeps that value.
 * - **The matrices are the Batch's** from then on: a `setMatrixAt` of the app's is drawn over at that
 *   instance's next write.
 * - **`color`** is an instance's colour, which three multiplies into the material's: in linear light,
 *   as `ThreeColours` splits it, `colorR`, `colorG` and `colorB`. The instances start white.
 * - **One Batch a mesh** in a runtime: a second `wardic.batch` of it is an error.
 *
 * @example
 * import * as WardicThree from "@wardic/three/WardicThree"
 *
 * const wardic = WardicThree.make()
 * const swarm = wardic.batch(instanced)
 * wardic.animate(swarm, { y: (i) => rowY(i), rotateY: 90 }, { type: "spring", delay: stagger(0.002) })
 * wardic.animate(swarm.at(42), { scale: 1.4, color: "#ff8800" })
 */
// `@wardic/three/ThreeInstances` (#883's PR 4; ADR-0069 decisions 11, 13, 14 and 19, ADR-0073 *Amendment
// (#883)*, PR 4's Q1–Q5). Probe `.tmp/883-instanced/` at 10,000 instances: three's way 561–584 µs a frame,
// `rotateY` alone 205–239 µs with the other axes' trig kept, translation alone 14–23 µs; the bounds' two
// passes over the matrices 68–73 µs, three's `computeBoundingSphere()` 370 µs. Per frame: plain code.
import type * as Batch from "@wardic/core/Batch"
import type * as WardicObject from "@wardic/object/WardicObject"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as Lookup from "./internal/lookup.ts"

/** A three buffer attribute Wardic writes: its floats, and how three is told what changed. */
interface AttributeLike {
  readonly array: Float32Array
  readonly count: number
  needsUpdate: boolean
  readonly addUpdateRange?: ((start: number, count: number) => void) | undefined
}

/** A three `Sphere`, as the bounds write one. */
interface SphereLike {
  readonly center: { readonly x: number; readonly y: number; readonly z: number; readonly set: (x: number, y: number, z: number) => unknown }
  radius: number
}

/** What three's `setColorAt` reads of a colour: its channels, into an array. */
interface ColourWriter {
  readonly toArray: (array: Float32Array, offset: number) => unknown
}

/** A three `InstancedMesh`, by its flag (ADR-0069 decision 3), as Wardic reads and writes one. */
interface InstancedLike {
  readonly isInstancedMesh: true
  readonly instanceMatrix: AttributeLike
  readonly instanceColor: AttributeLike | null
  readonly count: number
  readonly geometry: { readonly boundingSphere: SphereLike | null; readonly computeBoundingSphere: () => void }
  boundingSphere: SphereLike | null
  boundingBox: unknown
  readonly computeBoundingSphere: () => void
  readonly setColorAt: (index: number, colour: ColourWriter) => unknown
}

/** One instance of an `InstancedMesh` `M`, as its Batch's member: the mesh, and the instance's index. */
export interface Instance<M extends object = object> {
  readonly mesh: M
  readonly index: number
}

/** An instance's keys in a Batch: its transforms, and its colour's channels in linear light. */
export type InstanceKey = "x" | "y" | "z" | "rotateX" | "rotateY" | "rotateZ" | "scale" | "scaleX" | "scaleY" | "scaleZ" | "colorR" | "colorG" | "colorB"

/** The keys an instance takes, as `InstanceKey` names them. */
const KEYS: ReadonlySet<string> = new Set(["x", "y", "z", "rotateX", "rotateY", "rotateZ", "scale", "scaleX", "scaleY", "scaleZ", "colorR", "colorG", "colorB"])

/**
 * A member's start, kept by the Batch: its position, its rotation in degrees, its scale, then each
 * rotation axis's cos and sin, so a frame's trig is only for the axes the Batch turns.
 */
const STORE = 15
const AT_X = 0
const AT_Y = 1
const AT_Z = 2
const AT_SX = 6
const AT_SY = 7
const AT_SZ = 8
const COS_X = 9
const SIN_X = 10
const COS_Y = 11
const SIN_Y = 12
const COS_Z = 13
const SIN_Z = 14

/** Where a transform key's start is kept. `scale` is its `x`, as the lookup reads a mesh's. */
const STORE_AT: ReadonlyMap<string, number> = new Map([
  ["x", 0],
  ["y", 1],
  ["z", 2],
  ["rotateX", 3],
  ["rotateY", 4],
  ["rotateZ", 5],
  ["scale", 6],
  ["scaleX", 6],
  ["scaleY", 7],
  ["scaleZ", 8],
])

/** A colour channel key's place among an instance's three. */
const CHANNEL_AT: ReadonlyMap<string, number> = new Map([
  ["colorR", 0],
  ["colorG", 1],
  ["colorB", 2],
])

/** White, as `setColorAt` reads a colour: what makes a mesh's instance colours, every one white. */
const WHITE: ColourWriter = { toArray: (array, offset) => array.fill(1, offset, offset + 3) }

/** The meshes that have a Batch, in any runtime: what tells an instance's handle. */
// Module state: held weakly by the mesh.
const INSTANCED = new WeakSet<object>()

/** Whether `given` is a three `InstancedMesh`, by its flag. */
export const isInstancedMesh = (given: unknown): boolean => Predicate.isObject(given) && (given as { readonly isInstancedMesh?: unknown }).isInstancedMesh === true

/** Whether `given` is an instance a Batch's member handle names: one of a mesh that has a Batch. */
export const isInstance = (given: unknown): given is Instance => {
  if (!Predicate.isObject(given)) return false
  const mesh = (given as { readonly mesh?: unknown }).mesh
  return Predicate.isObject(mesh) && INSTANCED.has(mesh) && Predicate.isNumber((given as { readonly index?: unknown }).index)
}

/** `1 / s`, and 0 for a scale of 0: an axis scaled to nothing keeps no rotation to read. */
const inverse = (s: number): number => {
  if (s === 0) return 0
  return 1 / s
}

/**
 * The matrix at `o` in `te` read into `out` at `at`: its position, its rotation in degrees (Euler XYZ),
 * its scale, and each axis's cos and sin. three's `decompose` and `Euler.setFromRotationMatrix`, with a
 * mirrored matrix's sign on its x scale.
 */
export const decompose = (te: ArrayLike<number>, o: number, out: Float64Array, at: number): void => {
  const m0 = te[o]
  const m1 = te[o + 1]
  const m2 = te[o + 2]
  const m4 = te[o + 4]
  const m5 = te[o + 5]
  const m6 = te[o + 6]
  const m8 = te[o + 8]
  const m9 = te[o + 9]
  const m10 = te[o + 10]
  let sx = Math.hypot(m0, m1, m2)
  const sy = Math.hypot(m4, m5, m6)
  const sz = Math.hypot(m8, m9, m10)
  if (m0 * (m5 * m10 - m9 * m6) - m4 * (m1 * m10 - m9 * m2) + m8 * (m1 * m6 - m5 * m2) < 0) sx = -sx
  const ix = inverse(sx)
  const iy = inverse(sy)
  const iz = inverse(sz)
  const m13 = m8 * iz
  const ry = Math.asin(Math.min(Math.max(m13, -1), 1))
  let rx = Math.atan2(m6 * iy, m5 * iy)
  let rz = 0
  if (Math.abs(m13) < 0.9999999) {
    rx = Math.atan2(-m9 * iz, m10 * iz)
    rz = Math.atan2(-m4 * iy, m0 * ix)
  }
  out[at] = te[o + 12]
  out[at + 1] = te[o + 13]
  out[at + 2] = te[o + 14]
  out[at + 3] = rx / Lookup.RADIANS
  out[at + 4] = ry / Lookup.RADIANS
  out[at + 5] = rz / Lookup.RADIANS
  out[at + 6] = sx
  out[at + 7] = sy
  out[at + 8] = sz
  out[at + 9] = Math.cos(rx)
  out[at + 10] = Math.sin(rx)
  out[at + 11] = Math.cos(ry)
  out[at + 12] = Math.sin(ry)
  out[at + 13] = Math.cos(rz)
  out[at + 14] = Math.sin(rz)
}

/**
 * The matrix of a position, a rotation by its axes' cos and sin (`a`, `b` for x; `c`, `d` for y; `e`,
 * `f` for z; Euler XYZ) and a scale, written at `o` in `te`: three's `makeRotationFromEuler`, scaled.
 */
export const compose = (te: Float32Array, o: number, x: number, y: number, z: number, a: number, b: number, c: number, d: number, e: number, f: number, sx: number, sy: number, sz: number): void => {
  const ae = a * e
  const af = a * f
  const be = b * e
  const bf = b * f
  te[o] = c * e * sx
  te[o + 1] = (af + be * d) * sx
  te[o + 2] = (bf - ae * d) * sx
  te[o + 3] = 0
  te[o + 4] = -c * f * sy
  te[o + 5] = (ae - bf * d) * sy
  te[o + 6] = (be + af * d) * sy
  te[o + 7] = 0
  te[o + 8] = d * sz
  te[o + 9] = -b * c * sz
  te[o + 10] = a * c * sz
  te[o + 11] = 0
  te[o + 12] = x
  te[o + 13] = y
  te[o + 14] = z
  te[o + 15] = 1
}

/** A key's value for a member: the Batch's, at key index `k`, else its start's, kept at `at`. */
const valueAt = (positions: Float64Array, base: number, k: number, store: Float64Array, at: number): number => {
  if (k < 0) return store[at]
  return positions[base + k]
}

/** A rotation axis's cos for a member: of the Batch's angle, in degrees, else its start's, kept. */
const cosAt = (positions: Float64Array, base: number, k: number, store: Float64Array, at: number): number => {
  if (k < 0) return store[at]
  return Math.cos(positions[base + k] * Lookup.RADIANS)
}

/** A rotation axis's sin for a member: of the Batch's angle, in degrees, else its start's, kept. */
const sinAt = (positions: Float64Array, base: number, k: number, store: Float64Array, at: number): number => {
  if (k < 0) return store[at]
  return Math.sin(positions[base + k] * Lookup.RADIANS)
}

/** An axis's scale for a member: its own key, else `scale`, else its start's, kept. */
const scaleAt = (positions: Float64Array, base: number, axis: number, all: number, store: Float64Array, at: number): number => {
  if (axis >= 0) return positions[base + axis]
  if (all >= 0) return positions[base + all]
  return store[at]
}

/** `attribute`'s floats from `start`, `count` of them, uploaded at the next render: the span alone where three takes one. */
const upload = (attribute: AttributeLike, start: number, count: number): void => {
  if (Predicate.isFunction(attribute.addUpdateRange)) attribute.addUpdateRange(start, count)
  attribute.needsUpdate = true
}

/**
 * The sphere around the first `count` instances of `te`, into `sphere`: each instance's geometry sphere
 * (`geometry`) through its matrix, kept in `reach`, an AABB of them, then the farthest reach from its
 * middle. Every instance is inside it.
 */
// ADR-0069 decision 19, as PR 4's Q3 amends it: from the matrices, which hold every member, where a writer
// sees only those it writes. Two passes, no matrix product: 68–73 µs at 10,000 (`.tmp/883-instanced/`).
export const boundsOf = (te: Float32Array, count: number, geometry: SphereLike, reach: Float64Array, sphere: SphereLike): void => {
  if (count === 0) {
    sphere.center.set(0, 0, 0)
    sphere.radius = -1
    return
  }
  const cx = geometry.center.x
  const cy = geometry.center.y
  const cz = geometry.center.z
  const radius = geometry.radius
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let i = 0; i < count; i++) {
    const o = i * 16
    const m0 = te[o]
    const m1 = te[o + 1]
    const m2 = te[o + 2]
    const m4 = te[o + 4]
    const m5 = te[o + 5]
    const m6 = te[o + 6]
    const m8 = te[o + 8]
    const m9 = te[o + 9]
    const m10 = te[o + 10]
    const px = m0 * cx + m4 * cy + m8 * cz + te[o + 12]
    const py = m1 * cx + m5 * cy + m9 * cz + te[o + 13]
    const pz = m2 * cx + m6 * cy + m10 * cz + te[o + 14]
    const r = radius * Math.sqrt(Math.max(m0 * m0 + m1 * m1 + m2 * m2, m4 * m4 + m5 * m5 + m6 * m6, m8 * m8 + m9 * m9 + m10 * m10))
    const c = i * 4
    reach[c] = px
    reach[c + 1] = py
    reach[c + 2] = pz
    reach[c + 3] = r
    minX = Math.min(minX, px - r)
    minY = Math.min(minY, py - r)
    minZ = Math.min(minZ, pz - r)
    maxX = Math.max(maxX, px + r)
    maxY = Math.max(maxY, py + r)
    maxZ = Math.max(maxZ, pz + r)
  }
  const mx = (minX + maxX) / 2
  const my = (minY + maxY) / 2
  const mz = (minZ + maxZ) / 2
  let far = 0
  for (let i = 0; i < count; i++) {
    const c = i * 4
    far = Math.max(far, Math.hypot(reach[c] - mx, reach[c + 1] - my, reach[c + 2] - mz) + reach[c + 3])
  }
  sphere.center.set(mx, my, mz)
  sphere.radius = far
}

/** A key an instance doesn't take, refused when its Batch is made: an error naming why, and the way. */
const refuse = (key: string): never => {
  if (key === "color") {
    throw new Error(`wardic.batch: an InstancedMesh's instance colour takes its channels here, colorR, colorG and colorB, in linear light: its material has no Color to read "color" by.`)
  }
  throw new Error(`wardic.batch: an InstancedMesh's instances take their transforms (x, rotateY, scale…) and their colour (color), not "${key}". They share one material: animate it for all of them, wardic.animate(instanced.material, { ${key}: … }).`)
}

/** Whether any of `ks`, key indices, is a key the Batch has. */
const anyOf = (ks: ReadonlyArray<number>): boolean => Arr.some(ks, (k) => k >= 0)

/** `mesh`'s instances as a Batch's: their read, and a writer of their own, whose `flush` uploads what it wrote and bounds them. */
const instancesOf = (mesh: InstancedLike, capacity: number): Pick<WardicObject.BatchSource, "writer" | "read"> => {
  const store = new Float64Array(capacity * STORE)
  const scratch = new Float64Array(STORE)
  // The bounds' per-instance spheres, made at their first need.
  let reach = new Float64Array(0)
  let started = false
  // The span of instances a frame wrote, empty while `high < low`.
  let low = capacity
  let high = -1
  let colourLow = capacity
  let colourHigh = -1

  /** Every instance's matrix read once into its start, when the Batch is made. */
  const start = (): void => {
    const te = mesh.instanceMatrix.array
    for (let i = 0; i < capacity; i++) decompose(te, i * 16, store, i * STORE)
    started = true
  }

  /** The mesh's bounding sphere around its drawn instances, in place: three makes it the first time. Its box, computed again when it's asked for. */
  const bound = (): void => {
    if (Predicate.isNotNull(mesh.boundingBox)) mesh.boundingBox = null
    const sphere = mesh.boundingSphere
    if (Predicate.isNull(sphere)) {
      mesh.computeBoundingSphere()
      return
    }
    const geometry = mesh.geometry
    if (Predicate.isNull(geometry.boundingSphere)) geometry.computeBoundingSphere()
    const count = Math.min(mesh.count, capacity)
    if (reach.length < count * 4) reach = new Float64Array(capacity * 4)
    boundsOf(mesh.instanceMatrix.array, count, geometry.boundingSphere as SphereLike, reach, sphere)
  }

  const read = (subject: object, key: string): unknown => {
    const index = (subject as Instance).index
    const channel = CHANNEL_AT.get(key)
    if (Predicate.isNotUndefined(channel)) {
      const colours = mesh.instanceColor
      if (Predicate.isNull(colours)) return 1
      return colours.array[index * 3 + channel]
    }
    const at = STORE_AT.get(key)
    if (Predicate.isUndefined(at)) return undefined
    if (started) return store[index * STORE + at]
    // Before the Batch is made: its matrix now, as `get` reads it.
    decompose(mesh.instanceMatrix.array, index * 16, scratch, 0)
    return scratch[at]
  }

  const writer: Batch.Writer<object> = {
    writes: (key) => {
      if (KEYS.has(key)) return true
      return refuse(key)
    },
    forKeys: (keys) => {
      start()
      const ix = keys.indexOf("x")
      const iy = keys.indexOf("y")
      const iz = keys.indexOf("z")
      const irx = keys.indexOf("rotateX")
      const iry = keys.indexOf("rotateY")
      const irz = keys.indexOf("rotateZ")
      const is = keys.indexOf("scale")
      const isx = keys.indexOf("scaleX")
      const isy = keys.indexOf("scaleY")
      const isz = keys.indexOf("scaleZ")
      const icr = keys.indexOf("colorR")
      const icg = keys.indexOf("colorG")
      const icb = keys.indexOf("colorB")
      // A Batch that turns or scales composes each matrix; one that only moves writes its translation alone.
      const whole = anyOf([irx, iry, irz, is, isx, isy, isz])
      const transforms = whole || anyOf([ix, iy, iz])
      const colours = anyOf([icr, icg, icb])
      if (colours && Predicate.isNull(mesh.instanceColor)) mesh.setColorAt(0, WHITE)
      return (subject, positions, base) => {
        const index = (subject as Instance).index
        if (transforms) {
          const te = mesh.instanceMatrix.array
          const o = index * 16
          const s = index * STORE
          const x = valueAt(positions, base, ix, store, s + AT_X)
          const y = valueAt(positions, base, iy, store, s + AT_Y)
          const z = valueAt(positions, base, iz, store, s + AT_Z)
          if (whole) {
            compose(
              te,
              o,
              x,
              y,
              z,
              cosAt(positions, base, irx, store, s + COS_X),
              sinAt(positions, base, irx, store, s + SIN_X),
              cosAt(positions, base, iry, store, s + COS_Y),
              sinAt(positions, base, iry, store, s + SIN_Y),
              cosAt(positions, base, irz, store, s + COS_Z),
              sinAt(positions, base, irz, store, s + SIN_Z),
              scaleAt(positions, base, isx, is, store, s + AT_SX),
              scaleAt(positions, base, isy, is, store, s + AT_SY),
              scaleAt(positions, base, isz, is, store, s + AT_SZ),
            )
          }
          if (!whole) {
            te[o + 12] = x
            te[o + 13] = y
            te[o + 14] = z
          }
          low = Math.min(low, index)
          high = Math.max(high, index)
        }
        if (colours) {
          const array = (mesh.instanceColor as AttributeLike).array
          const c = index * 3
          if (icr >= 0) array[c] = positions[base + icr]
          if (icg >= 0) array[c + 1] = positions[base + icg]
          if (icb >= 0) array[c + 2] = positions[base + icb]
          colourLow = Math.min(colourLow, index)
          colourHigh = Math.max(colourHigh, index)
        }
      }
    },
    flush: () => {
      if (high >= low) {
        upload(mesh.instanceMatrix, low * 16, (high - low + 1) * 16)
        low = capacity
        high = -1
        bound()
      }
      if (colourHigh >= colourLow) {
        upload(mesh.instanceColor as AttributeLike, colourLow * 3, (colourHigh - colourLow + 1) * 3)
        colourLow = capacity
        colourHigh = -1
      }
    },
  }
  return { writer, read }
}

/**
 * A runtime's Batches of instances, its Environment's `batchSource`: an `InstancedMesh`'s instances as a
 * Batch's members, a handle each, `{ mesh, index }`, drawn by a writer of its own; `undefined` for
 * anything else. A mesh is one Batch's in the runtime.
 */
// PR 4's Q1. Per runtime, so a disposed one (a hot reload's) leaves its meshes free for the next.
export const batchSource = (): ((given: object) => WardicObject.BatchSource | undefined) => {
  // Held weakly by the mesh.
  const batched = new WeakSet<object>()
  return (given) => {
    if (!isInstancedMesh(given)) return undefined
    const mesh = given as InstancedLike
    if (batched.has(mesh)) throw new Error("wardic.batch: this InstancedMesh has a Batch already, which draws its instances: keep the one wardic.batch gave. An InstancedMesh is one Batch's.")
    const capacity = mesh.instanceMatrix.count
    if (capacity === 0) throw new Error("wardic.batch: this InstancedMesh holds no instances: a Batch of it has a member for each instance it holds.")
    batched.add(mesh)
    INSTANCED.add(mesh)
    const members = Arr.makeBy(capacity, (index): Instance => ({ mesh, index }))
    return { members, ...instancesOf(mesh, capacity) }
  }
}
