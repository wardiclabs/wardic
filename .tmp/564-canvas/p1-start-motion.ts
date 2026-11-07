// PROTOTYPE P1c (#564): Motion's start latency in the same pattern (call, then processFrame, no task between).
await import("./dom-shim.ts")
import * as THREE from "three"
const motion = await import("motion")
const { threeEffect } = await import("motion/three")
motion.MotionGlobalConfig.useManualTiming = true
motion.animate.addEffect?.(threeEffect)
let t = 0
const o = new THREE.Object3D()
const next = () => { t += 1000 / 60; motion.processFrame(t) }
const report = (l: string) => console.log(l.padEnd(44), "x =", o.position.x.toFixed(4))
motion.processFrame(t)
motion.animate(o, { x: 1 }, { type: "spring" }); next(); report("idle, call then frame, no task between")
next(); report("next frame")
for (let i = 0; i < 80; i++) next()
motion.animate(o, { x: 2 }, { type: "spring" }); next(); report("settled, call then frame, no task between")
next(); next(); motion.animate(o, { x: 3 }, { type: "spring" }); next(); report("running, retarget then frame, no task")
process.exit(0)
