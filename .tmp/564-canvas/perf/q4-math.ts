// PROTOTYPE (#564 Q4): the GPU path's retarget math in JS, against the CPU group, with no shader.
import * as Spring from "../../../packages/core/src/Spring.ts"
import { makeObjectEnvironment, pumped } from "../wardic-object.ts"
import { makeGroup, K } from "./group.ts"
import { springAt } from "./gpu-spring.ts"
const SPRING = { stiffness: 210, damping: 20 }, DT = 1000 / 60
let t = 0
const source = pumped(() => t)
const env = makeObjectEnvironment(source)
const g = makeGroup(env.runtime as never, 1, (_, into, b) => { into[b + 4] = 1 }, () => {}, SPRING)
const e = Spring.matrixFor(Spring.resolve(SPRING), 1 / 60)
// GPU state for key x
let from = 0, vel = 0, goal = 0, t0 = 0
const gpuX = (nowS: number) => goal + springAt(e, from - goal, vel, nowS - t0)[0]
const setGpu = (x: number, nowS: number) => { const [d, v] = springAt(e, from - goal, vel, nowS - t0); from = goal + d; vel = v; goal = x; t0 = nowS }
g.set(0, { x: 10, y: 0, z: 0, rotateY: 0, scale: 1 }); setGpu(10, 0)
for (let f = 1; f <= 40; f++) {
  await new Promise((r) => setTimeout(r, 0))
  t += DT; source.pump(t)
  if (f === 20) { g.set(0, { x: -5, y: 0, z: 0, rotateY: 0, scale: 1 }); setGpu(-5, t / 1000) }
  if ([10, 19, 20, 21, 22, 25, 40].includes(f)) console.log(`f${f}`, "cpu", g.pos[0].toFixed(5), "gpu-math", gpuX(t / 1000).toFixed(5), "cpu v", g.vel[0].toFixed(4))
}
process.exit(0)
