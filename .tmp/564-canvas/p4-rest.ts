/**
 * PROTOTYPE P4 (#564): are Motion's pixel-tuned spring rest thresholds wrong in a scene's units?
 * Steps core's `springValues` by hand at 60 Hz and records, per move, the frame the spring is
 * called at rest and the jump it makes there (the distance snapped to the target). Motion's own
 * animate on a plain object is stepped the same way, for comparison.
 *
 *   bun p4-rest.ts
 */
import * as Machine from "../../packages/core/src/Machine.ts"
await import("./dom-shim.ts")
const motion = await import("motion")
motion.MotionGlobalConfig.useManualTiming = true

const DT = 1 / 60
const springs = { "stiff 210/20": { stiffness: 210, damping: 20 }, "Motion default 100/10": { stiffness: 100, damping: 10 } }
const moves = [0.05, 0.5, 1, 4.9, 5, 10, 50, 90, 360]

const wardic = (distance: number, opts: { stiffness: number; damping: number }) => {
  const step = Machine.springValues({ x: distance }, opts, { from: { x: 0 } }).start()
  let prev = 0
  for (let i = 1; i < 2000; i++) {
    const f = step(DT)
    if (f.done) return { frame: i, jump: Math.abs(distance - prev), jumpPct: (100 * Math.abs(distance - prev)) / distance }
    prev = f.value.x
  }
  return { frame: Infinity, jump: NaN, jumpPct: NaN }
}

const motionRest = async (distance: number, opts: { stiffness: number; damping: number }) => {
  const o = { x: 0 }
  let t = 0
  motion.processFrame(t)
  let done = false
  const controls = motion.animate(o, { x: distance }, { type: "spring", ...opts })
  void controls.then(() => (done = true))
  let prev = 0
  for (let i = 1; i < 2000; i++) {
    t += DT * 1000
    motion.processFrame(t)
    await Promise.resolve()
    await Promise.resolve()
    if (done || o.x === distance) return { frame: i, jump: Math.abs(distance - prev), jumpPct: (100 * Math.abs(distance - prev)) / distance }
    prev = o.x
  }
  return { frame: Infinity, jump: NaN, jumpPct: NaN }
}

for (const [name, opts] of Object.entries(springs)) {
  console.log(`\n${name}: move → frames to rest, the jump at rest (abs, % of the move)`)
  for (const d of moves) {
    const w = wardic(d, opts)
    const m = await motionRest(d, opts)
    console.log(
      `  ${String(d).padStart(5)}  wardic ${String(w.frame).padStart(3)}f jump ${w.jump.toFixed(4).padStart(7)} (${w.jumpPct.toFixed(2).padStart(5)}%)` +
        `   motion ${String(m.frame).padStart(3)}f jump ${m.jump.toFixed(4).padStart(7)} (${m.jumpPct.toFixed(2).padStart(5)}%)`,
    )
  }
}
process.exit(0)
