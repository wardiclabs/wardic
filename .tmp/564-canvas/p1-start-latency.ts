/**
 * PROTOTYPE P1b (#564): once the runtime is built, does `animate()` move the object at the very
 * next pump, with no task in between? (A host frame can follow the call before any setTimeout(0).)
 *   bun .tmp/564-canvas/p1-start-latency.ts
 */
import * as THREE from "three"
import { makeObjectEnvironment, pumped } from "./wardic-object.ts"
let t = 0
const env = makeObjectEnvironment(pumped(() => t))
const o = new THREE.Object3D()
const next = () => { t += 1000 / 60; env.source.pump(t) }
const report = (label: string) => console.log(label.padEnd(44), "x =", o.position.x.toFixed(4), "wantsFrame:", env.source.wantsFrame())

// 1. Cold: the runtime isn't built yet.
env.animate(o, { x: 1 })
next(); report("cold, pumped with no task between")
await new Promise((r) => setTimeout(r, 0)); next(); report("cold, after one task")
for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 0)); next() }
report("cold, settled")

// 2. Warm runtime, idle Clock: call, then pump synchronously.
env.animate(o, { x: 2 })
next(); report("warm, idle clock, no task between")
await Promise.resolve(); next(); report("warm, after a microtask")
await new Promise((r) => setTimeout(r, 0)); next(); report("warm, after one task")

// 3. Warm runtime, running Clock: retarget mid-flight, pump synchronously.
env.animate(o, { x: 3 })
next(); report("running clock, retarget, no task between")
await new Promise((r) => setTimeout(r, 0)); next(); report("running clock, after one task")
process.exit(0)
