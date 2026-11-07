/**
 * PROTOTYPE P3 (#564): what a write costs on Three.js r187's objects, per write, and the colour
 * midpoints each blend gives.
 *
 * - Colour: a CSS string through `color.set` (motion/three's path: `setStyle`'s regex parse, then
 *   sRGB → linear), `setRGB` with sRGB numbers, and the linear channels stored directly.
 * - Rotation: three per-axis Euler writes (motion/three writes a key at a time; each one runs the
 *   Euler's onChange, a quaternion sync), against one `rotation.set`.
 * - Position: three per-axis writes against one `position.set` (Vector3 has no onChange).
 *
 *   bun p3-writes.ts ; node --experimental-strip-types --no-warnings p3-writes.ts
 */
import * as THREE from "three"

const ITER = 2_000_000
const time = (label: string, body: (i: number) => void) => {
  for (let i = 0; i < 200_000; i++) body(i) // warm
  const t0 = performance.now()
  for (let i = 0; i < ITER; i++) body(i)
  const ns = ((performance.now() - t0) * 1e6) / ITER
  console.log(label.padEnd(56), ns.toFixed(1).padStart(7), "ns")
  return ns
}

const c = new THREE.Color()
const strings = Array.from({ length: 256 }, (_, i) => `rgb(${i}, ${255 - i}, ${(i * 7) % 256})`)
let sink = 0
console.log(`three ${THREE.REVISION}, ${typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? `node ${process.version}` : "bun"}`)
time("colour: color.set('rgb(…)')  (string + parse)", (i) => {
  c.set(strings[i & 255])
  sink += c.r
})
time("colour: build the string + color.set  (motion/three)", (i) => {
  c.set(`rgba(${i & 255}, ${255 - (i & 255)}, ${(i * 7) & 255}, 1)`)
  sink += c.r
})
time("colour: color.setRGB(r, g, b, SRGB)  (sRGB numbers)", (i) => {
  c.setRGB((i & 255) / 255, (255 - (i & 255)) / 255, ((i * 7) & 255) / 255, THREE.SRGBColorSpace)
  sink += c.r
})
time("colour: c.r = …; c.g = …; c.b = …  (linear channels)", (i) => {
  c.r = (i & 255) / 255
  c.g = (255 - (i & 255)) / 255
  c.b = ((i * 7) & 255) / 255
  sink += c.r
})

const o = new THREE.Object3D()
time("rotation: rotation.x/.y/.z = …  (3 quaternion syncs)", (i) => {
  const a = (i & 1023) * 0.001
  o.rotation.x = a
  o.rotation.y = a + 0.1
  o.rotation.z = a + 0.2
  sink += o.quaternion.w
})
time("rotation: rotation.set(x, y, z)  (1 sync)", (i) => {
  const a = (i & 1023) * 0.001
  o.rotation.set(a, a + 0.1, a + 0.2)
  sink += o.quaternion.w
})
time("rotation: rotation.y = …  (1 key, 1 sync)", (i) => {
  o.rotation.y = (i & 1023) * 0.001
  sink += o.quaternion.w
})
time("position: position.x/.y/.z = …", (i) => {
  const a = (i & 1023) * 0.001
  o.position.x = a
  o.position.y = a + 0.1
  o.position.z = a + 0.2
  sink += o.position.x
})
time("position: position.set(x, y, z)", (i) => {
  const a = (i & 1023) * 0.001
  o.position.set(a, a + 0.1, a + 0.2)
  sink += o.position.x
})

// Colour midpoints, red → blue at t = 0.5, written to a three Color and read back as sRGB bytes.
const bytes = (col: THREE.Color) => col.getHexString()
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mid = new THREE.Color()
mid.setRGB(lerp(1, 0, 0.5), 0, lerp(0, 1, 0.5), THREE.SRGBColorSpace) // sRGB lerp (Wardic's DOM blend, CSS's)
const srgbLerp = bytes(mid)
const sq = (a: number, b: number, t: number) => Math.sqrt(a * a + (b * b - a * a) * t)
mid.setRGB(sq(1, 0, 0.5), 0, sq(0, 1, 0.5), THREE.SRGBColorSpace) // Motion's JS mix (mixLinearColor: a gamma-2 blend)
const motionMix = bytes(mid)
const red = new THREE.Color("#ff0000"), blue = new THREE.Color("#0000ff")
const linearMid = bytes(red.clone().lerp(blue, 0.5)) // three's Color.lerp: linear-sRGB channels
console.log("midpoint red→blue: sRGB lerp #" + srgbLerp, "| Motion's mix #" + motionMix, "| three's linear lerp #" + linearMid)
if (sink === 42) console.log(sink)
