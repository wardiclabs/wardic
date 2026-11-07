/**
 * PROTOTYPE P5 (#564), the page: in Chromium, does an animation's write land in the frame the
 * scene renders, or a frame late? The scene renders a real WebGLRenderer, and at each render the
 * page records how many frames old the drawn value is.
 *
 * Every rAF callback is wrapped to publish its frame's timestamp, so a write (a Wardic sink,
 * Motion's onUpdate) is stamped with the frame it happened in.
 */
import * as THREE from "three"
import * as Machine from "../../packages/core/src/Machine.ts"
import * as Supersede from "../../packages/core/src/Supersede.ts"
import { makeObjectEnvironment, pumped } from "./wardic-object.ts"

declare global {
  interface Window { __results: Record<string, unknown>; __done: boolean }
}

let frameTs = 0
const raf = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = (cb) => raf((ts) => { frameTs = ts; cb(ts) })

const canvas = document.createElement("canvas")
canvas.width = 64
canvas.height = 64
document.body.append(canvas)
const renderer = new THREE.WebGLRenderer({ canvas })
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
camera.position.z = 20
const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
scene.add(mesh)
window.__results = { webgl: renderer.getContext() !== null, three: THREE.REVISION }

const FRAMES = 40
const BOUNCY = { stiffness: 20, damping: 1 } // long-lived: it never rests inside a case
let lastWriteTs = -1
const stamp = () => { lastWriteTs = frameTs }
const histogram = (lags: Array<number>) => {
  const h: Record<string, number> = {}
  for (const l of lags) h[`${l} frame(s) late`] = (h[`${l} frame(s) late`] ?? 0) + 1
  return h
}

type Loop = "three" | "motion-render"
interface Case {
  readonly name: string
  readonly loop: Loop
  /** The case starts the scene loop itself, later. */
  readonly deferScene?: boolean
  /** Starts the animation. `startScene` starts the scene's loop: called first or after, as the case decides. */
  readonly run: (startScene: () => void, setPre: (pre: (ts: number) => void) => void) => () => void
}

const runCase = (c: Case) =>
  new Promise<void>((resolve) => {
    mesh.position.set(0, 0, 0)
    lastWriteTs = -1
    const lags: Array<number> = []
    let frames = 0
    let pre: (ts: number) => void = () => {}
    let stop: () => void = () => {}
    const finish = () => {
      stop()
      window.__results[c.name] = histogram(lags)
      resolve()
    }
    const onRender = (ts: number) => {
      renderer.render(scene, camera)
      if (lastWriteTs >= 0) {
        lags.push(Math.round((ts - lastWriteTs) / (1000 / 60)))
        frames++
      }
    }
    let started = false
    const startScene = () => {
      if (started) return
      started = true
      if (c.loop === "three") {
        renderer.setAnimationLoop((ts) => {
          pre(ts)
          onRender(ts)
          if (frames >= FRAMES) {
            renderer.setAnimationLoop(null)
            finish()
          }
        })
      } else {
        const tick = () => {
          onRender(frameTs)
          if (frames >= FRAMES) finish()
          else motionLib.frame.render(tick)
        }
        motionLib.frame.render(tick)
      }
    }
    stop = c.run(startScene, (p) => { pre = p })
    if (!c.deferScene) startScene()
  })

const rafSource = { requestFrame: (cb: (t: number) => void) => requestAnimationFrame(cb), cancelFrame: (h: unknown) => cancelAnimationFrame(h as number) }
const wardicRaf = makeObjectEnvironment(rafSource as never)
const source = pumped()
const wardicPumped = makeObjectEnvironment(source)
const motionLib = await import("motion")
const { threeEffect } = await import("motion/three")
motionLib.animate.addEffect?.(threeEffect)

/** A spring run on `env`'s Frame loop writing the mesh, ended by the returned function. */
const wardicSpring = (env: ReturnType<typeof makeObjectEnvironment>, to: number) => {
  const token = Supersede.make()
  void env.runtime.runPromise(
    Machine.run(Machine.spring(to, BOUNCY), (f) => { mesh.position.x = f.value; stamp(); return undefined }, { supersede: token }),
  )
  return () => Supersede.end(token)
}
const later = (ms: number) => new Promise((r) => setTimeout(r, ms))

const cases: Array<Case> = [
  {
    name: "A. wardic on window rAF, scene loop (setAnimationLoop) started first",
    loop: "three",
    run: (startScene) => {
      startScene()
      let stop = () => {}
      void later(50).then(() => { stop = wardicSpring(wardicRaf, 10) })
      return () => stop()
    },
  },
  {
    name: "B. wardic on window rAF, animation started first",
    loop: "three",
    run: () => wardicSpring(wardicRaf, -10),
  },
  {
    name: "B2. wardic on window rAF, animation started a task before the scene loop",
    loop: "three",
    deferScene: true,
    run: (startScene) => {
      const stop = wardicSpring(wardicRaf, 10)
      void later(50).then(startScene)
      return stop
    },
  },
  {
    name: "C. wardic on host-pumped frames, pumped before render",
    loop: "three",
    run: (_, setPre) => {
      setPre((ts) => { frameTs = ts; source.pump(ts) })
      return wardicSpring(wardicPumped, 10)
    },
  },
  {
    name: "D. motion/three on Motion's rAF, scene loop (setAnimationLoop) started first",
    loop: "three",
    run: (startScene) => {
      startScene()
      let stop = () => {}
      void later(50).then(() => {
        const c = motionLib.animate(mesh, { x: 10 }, { type: "spring", ...BOUNCY, onUpdate: stamp })
        stop = () => c.stop()
      })
      return () => stop()
    },
  },
  {
    name: "E. motion/three, scene rendered in Motion's frame.render",
    loop: "motion-render",
    run: () => {
      const c = motionLib.animate(mesh, { x: -10 }, { type: "spring", ...BOUNCY, onUpdate: stamp })
      return () => c.stop()
    },
  },
]
for (const c of cases) {
  await runCase(c)
  await later(100)
}
window.__done = true
