/**
 * PROTOTYPE (#564 perf round, Q2): one run on core's Frame loop for many subjects.
 *
 * Each subject's 5 keys ({ x, y, z, rotateY, scale }) live in typed arrays: position, velocity,
 * target and rest thresholds. One machine steps the subjects still moving with core's exact spring
 * matrix (`Spring.matrixFor`, #370), and calls `write(i)` for each. A retarget is `set(i, target)`,
 * an array write: no run, no fiber, no token. Velocity carries because the state is never thrown
 * away. The run settles when nothing moves, and the next `set` starts it again.
 */
import * as Machine from "../../../packages/core/src/Machine.ts"
import * as Spring from "../../../packages/core/src/Spring.ts"

export const K = 5 // x, y, z, rotateY, scale
export interface Target { x: number; y: number; z: number; rotateY: number; scale: number }

export interface Group {
  readonly pos: Float64Array
  readonly vel: Float64Array
  readonly set: (i: number, target: Target) => void
  readonly moving: () => number
}

type Runtime = { runPromise: <A>(effect: unknown) => Promise<A> }

export const makeGroup = (
  runtime: Runtime,
  n: number,
  initial: (i: number, into: Float64Array, base: number) => void,
  write: (i: number, pos: Float64Array, base: number) => void,
  options: Machine.SpringOptions & {
    /** Called once a frame after every write: an InstancedMesh's `needsUpdate`. */
    readonly flush?: () => void
    /** Called when subject i comes to rest, and when it starts again. */
    readonly onRest?: (i: number) => void
    readonly onWake?: (i: number) => void
  } = {},
): Group => {
  const pos = new Float64Array(n * K)
  const vel = new Float64Array(n * K)
  const goal = new Float64Array(n * K)
  const restD = new Float64Array(n * K)
  const restS = new Float64Array(n * K)
  for (let i = 0; i < n; i++) {
    initial(i, pos, i * K)
    for (let j = 0; j < K; j++) goal[i * K + j] = pos[i * K + j]
  }
  const active = new Uint8Array(n)
  const list = new Int32Array(n)
  let count = 0
  const spring = Spring.resolve(options)
  const { flush, onRest, onWake } = options
  const frame = { value: 0, done: false }

  const machine = Machine.make({
    settles: true,
    span: { name: "probe.group", attributes: { n } },
    start: () => (dt: number) => {
      const m = Spring.matrixFor(spring, Math.min(dt, Machine.MAX_DT))
      const dd = m.dd, dv = m.dv, vd = m.vd, vv = m.vv
      let kept = 0
      for (let a = 0; a < count; a++) {
        const i = list[a]
        const base = i * K
        let moving = false
        for (let j = 0; j < K; j++) {
          const at = base + j
          const g = goal[at]
          const d = pos[at] - g
          const v = vel[at]
          let p = g + dd * d + dv * v
          let s = vd * d + vv * v
          if (Math.abs(s) <= restS[at] && Math.abs(p - g) <= restD[at]) {
            p = g
            s = 0
          } else moving = true
          pos[at] = p
          vel[at] = s
        }
        write(i, pos, base)
        if (moving) list[kept++] = i
        else {
          active[i] = 0
          onRest?.(i)
        }
      }
      count = kept
      flush?.()
      frame.done = count === 0
      return frame
    },
  })

  let running = false
  const noop = () => undefined
  const ensure = () => {
    if (running) return
    running = true
    void runtime.runPromise(Machine.run(machine, noop)).then(() => {
      running = false
      if (count > 0) ensure()
    })
  }

  const set = (i: number, t: Target) => {
    const base = i * K
    goal[base] = t.x
    goal[base + 1] = t.y
    goal[base + 2] = t.z
    goal[base + 3] = t.rotateY
    goal[base + 4] = t.scale
    for (let j = 0; j < K; j++) {
      const at = base + j
      restD[at] = Spring.restDeltaFor(spring, goal[at] - pos[at])
      restS[at] = Spring.restSpeedFor(spring, goal[at] - pos[at])
    }
    if (active[i] === 0) {
      active[i] = 1
      list[count++] = i
      onWake?.(i)
    }
    ensure()
  }

  return { pos, vel, set, moving: () => count }
}
