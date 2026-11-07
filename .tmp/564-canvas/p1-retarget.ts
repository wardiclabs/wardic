/**
 * PROTOTYPE P1 (#564): does the core-only object animator drive a Three.js Object3D, and does a
 * retarget keep position and velocity continuous, as Motion's does? Prints both traces side by side.
 *
 *   bun .tmp/564-canvas/p1-retarget.ts
 */
import * as THREE from "three"
import { makeObjectEnvironment, pumped } from "./wardic-object.ts"

const DT = 1000 / 60
let t = 0
const { animate, source } = makeObjectEnvironment(pumped(() => t))

// Motion, driven by hand the same way.
await import("./dom-shim.ts")
const motion = await import("motion")
const { threeEffect } = await import("motion/three")
motion.MotionGlobalConfig.useManualTiming = true
motion.animate.addEffect?.(threeEffect)

const w = new THREE.Object3D()
const m = new THREE.Object3D()
const spring = { stiffness: 210, damping: 20 }

const rows: Array<string> = []
let lastW = 0, lastM = 0
const yieldTask = () => new Promise((r) => setTimeout(r, 0))
const frame = async (label: string) => {
  await yieldTask() // a real host's frames are tasks apart: let Effect's scheduler run between them
  t += DT
  source.pump(t)
  motion.processFrame(t)
  const vw = (w.position.x - lastW) / (DT / 1000)
  const vm = (m.position.x - lastM) / (DT / 1000)
  lastW = w.position.x
  lastM = m.position.x
  rows.push(`${label.padEnd(9)} wardic x=${w.position.x.toFixed(4).padStart(8)} v=${vw.toFixed(2).padStart(7)} rotY=${(w.rotation.y / (Math.PI / 180)).toFixed(2).padStart(7)} | motion x=${m.position.x.toFixed(4).padStart(8)} v=${vm.toFixed(2).padStart(7)} rotY=${(m.rotation.y / (Math.PI / 180)).toFixed(2).padStart(7)}`)
}

motion.processFrame(t)
animate(w, { x: 10, rotateY: 90 }, spring)
motion.animate(m, { x: 10, rotateY: 90 }, { type: "spring", ...spring })
for (let i = 0; i < 12; i++) await frame(`f${i}`)
// Retarget x only, mid-flight: rotateY must keep going to 90 (carried), x must turn smoothly.
const landed = animate(w, { x: -5 }, spring)
motion.animate(m, { x: -5 }, { type: "spring", ...spring })
for (let i = 12; i < 120; i++) await frame(i === 12 ? "f12 (rt)" : `f${i}`)
console.log(rows.filter((_, i) => i < 20 || i % 10 === 0).join("\n"))
console.log("wardic outcome:", await Promise.race([landed, new Promise((r) => setTimeout(() => r("pending"), 50))]))
console.log("final", { wardic: [w.position.x, w.rotation.y / (Math.PI / 180)], motion: [m.position.x, m.rotation.y / (Math.PI / 180)] })
process.exit(0)
