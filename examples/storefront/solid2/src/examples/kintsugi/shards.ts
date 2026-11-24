/**
 * The Celadon Cone Bowl in shards (#935): its wall tiled into about 3,000 thin flakes, in rings from the
 * middle of its floor out and up to its rim, as the potter's throwing lines run. Each ring is a different
 * height, and its flakes different widths from a different start, so the cracks between them never line up:
 * the glaze's crackle. Each has a pose on the wall, and one flung from a point on it.
 *
 * @module
 */
import * as THREE from "three"

/** A shard's pose: where it is, its turn in degrees, and its size; the keys a Batch of instances takes. A type, not an interface, so it's a Batch's values. */
export type Pose = {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly rotateX: number
  readonly rotateY: number
  readonly rotateZ: number
  readonly scaleX: number
  readonly scaleY: number
  readonly scaleZ: number
}

/** The bowl's wall through its middle, from the centre of its floor to its rim, as [radius, height]: a flat floor, then a cone. */
export const WALL: ReadonlyArray<readonly [number, number]> = [
  [0, 0.14],
  [0.48, 0.14],
  [0.56, 0.2],
  [1.32, 1.18],
]

/** A shard's size, about; how much of it is glaze, the rest crackle; and its thickness, a flake's. */
const SIZE = 0.05
const WHOLE = 0.955
const THICK = 0.026

/** A seeded random, the same shards every time: from 0 up to 1. */
const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/** The wall's length along its profile, and where a length `s` along it is: its radius, height and direction. */
const along = (() => {
  const legs = WALL.slice(1).map(([radius, height], i) => {
    const [r0, h0] = WALL[i]!
    return { r0, h0, dr: radius - r0, dh: height - h0, length: Math.hypot(radius - r0, height - h0) }
  })
  const length = legs.reduce((sum, leg) => sum + leg.length, 0)
  const at = (s: number): { readonly radius: number; readonly height: number; readonly dr: number; readonly dh: number } => {
    let left = s
    for (const leg of legs) {
      if (left <= leg.length) {
        const t = left / leg.length
        return { radius: leg.r0 + leg.dr * t, height: leg.h0 + leg.dh * t, dr: leg.dr / leg.length, dh: leg.dh / leg.length }
      }
      left -= leg.length
    }
    const last = legs[legs.length - 1]!
    return { radius: last.r0 + last.dr, height: last.h0 + last.dh, dr: last.dr / last.length, dh: last.dh / last.length }
  }
  return { length, at }
})()

/** A turn as Euler angles in degrees, three's order (XYZ). */
const degreesOf = (quaternion: THREE.Quaternion): Pick<Pose, "rotateX" | "rotateY" | "rotateZ"> => {
  const euler = new THREE.Euler().setFromQuaternion(quaternion)
  return { rotateX: THREE.MathUtils.radToDeg(euler.x), rotateY: THREE.MathUtils.radToDeg(euler.y), rotateZ: THREE.MathUtils.radToDeg(euler.z) }
}

/** The bowl's shards: each one's pose on the wall, its pose mended (a little smaller, for the gold between), and the way out of the wall it faces. */
export interface Shards {
  readonly count: number
  readonly home: ReadonlyArray<Pose>
  readonly mended: ReadonlyArray<Pose>
  readonly normals: ReadonlyArray<THREE.Vector3>
}

/** How much of its place a mended shard fills: the rest is the gold that holds it. */
const MENDED = 0.86

/** The shards, ring by ring up the wall: each ring's height and its flakes' widths at random, filling it exactly. */
export const shardsOf = (): Shards => {
  const random = seeded(911)
  const home: Array<Pose> = []
  const normals: Array<THREE.Vector3> = []
  let from = 0
  while (from < along.length - 1e-6) {
    const ring = Math.min(along.length - from, SIZE * (0.7 + random() * 0.6))
    const { radius, height: y, dr, dh } = along.at(from + ring / 2)
    from += ring
    // Widths at random, scaled to go round exactly, from a start at random.
    const widths: Array<number> = []
    let round = 0
    while (round < 2 * Math.PI * radius || widths.length < 6) {
      const width = SIZE * (0.6 + random() * 0.8)
      widths.push(width)
      round += width
    }
    const scale = (2 * Math.PI * radius) / round
    let theta = random() * 2 * Math.PI
    for (const raw of widths) {
      const width = raw * scale
      const middle = theta + width / radius / 2
      theta += width / radius
      // Round the bowl, up its wall, and out of it: the shard's own axes, turned a degree or two off true.
      const across = new THREE.Vector3(Math.cos(middle), 0, -Math.sin(middle))
      const up = new THREE.Vector3(dr * Math.sin(middle), dh, dr * Math.cos(middle))
      const out = new THREE.Vector3().crossVectors(across, up).normalize()
      const turn = new THREE.Quaternion()
        .setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, out))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (random() - 0.5) * 0.05))
      home.push({
        x: radius * Math.sin(middle),
        y,
        z: radius * Math.cos(middle),
        ...degreesOf(turn),
        scaleX: width * WHOLE,
        scaleY: ring * WHOLE,
        scaleZ: THICK,
      })
      normals.push(out)
    }
  }
  const mended = home.map((pose) => ({ ...pose, scaleX: pose.scaleX * MENDED, scaleY: pose.scaleY * MENDED }))
  return { count: home.length, home, mended, normals }
}

/** How far each shard is from `impact`: when it leaves, and when it comes home. */
export const distancesFrom = (shards: Shards, impact: THREE.Vector3): Float32Array =>
  Float32Array.from(shards.home, (pose) => impact.distanceTo(new THREE.Vector3(pose.x, pose.y, pose.z)))

/**
 * Each shard flung from `impact`: away from it and out of the wall, a little up, the nearest farthest,
 * tumbling as it goes. Seeded, so a break from the same point flies the same way.
 */
export const flungFrom = (shards: Shards, impact: THREE.Vector3): ReadonlyArray<Pose> => {
  const random = seeded(4099)
  return shards.home.map((pose, i) => {
    const from = new THREE.Vector3(pose.x, pose.y, pose.z)
    // Near the strike, a shard bursts away from it; across the bowl, it only comes loose and tumbles.
    const near = Math.max(0, 1 - impact.distanceTo(from) / 2.2) ** 1.5
    const away = from.clone().sub(impact).normalize().multiplyScalar(0.9).add(shards.normals[i]!).add(new THREE.Vector3(0, 0.35, 0)).normalize()
    const to = from.add(away.multiplyScalar(0.12 + near * 2 + random() * (0.1 + near * 0.5)))
    return {
      ...pose,
      x: to.x,
      y: to.y,
      z: to.z,
      rotateX: pose.rotateX + (random() - 0.5) * 420,
      rotateY: pose.rotateY + (random() - 0.5) * 420,
      rotateZ: pose.rotateZ + (random() - 0.5) * 420,
    }
  })
}
