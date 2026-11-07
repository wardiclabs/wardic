/**
 * PROTOTYPE (#564 pressure test, throwaway): `@wardic/object`'s step 1, on `@wardic/core` alone.
 *
 * Question it answers: how much new code does it take to drive a Three.js scene with core's
 * springs, with Motion's latest-wins and velocity carried across a retarget, and no spine?
 *
 * - A Refresh frame source the HOST pumps (`pump(time)`), so writes land inside the host's own
 *   frame, before it renders (window rAF, an XR session's loop, a render-on-demand loop alike).
 * - An object writer per call: Motion's key names (`x`, `rotateY` in degrees, `scale`), grouped
 *   into one `position.set` / `rotation.set` per frame.
 * - Latest-wins per object: a new call ends the run before it (a Supersede token), carries the
 *   keys it doesn't name to their old targets, and seeds every key from the last frame's value and
 *   velocity. For a physics spring that's exact: (position, velocity) is the whole state.
 *
 * Numbers only. No tweens' or keyframes' velocity, no colours, no variants, presence or gestures.
 */
import * as Clock from "../../packages/core/src/Clock.ts"
import * as FrameLoop from "../../packages/core/src/FrameLoop.ts"
import * as Machine from "../../packages/core/src/Machine.ts"
import * as RefreshFrameSource from "../../packages/core/src/RefreshFrameSource.ts"
import * as Supersede from "../../packages/core/src/Supersede.ts"
type SpringOptions = Machine.SpringOptions
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

// --- The frame source the host pumps ----------------------------------------------------------

export interface Pumped extends RefreshFrameSource.Shape<(t: number) => void> {
  /** Runs every callback asked for before this call, with `time` in ms. Call it before rendering. */
  readonly pump: (time: number) => void
  /** Whether Wardic wants another frame: what a render-on-demand host checks to keep going. */
  readonly wantsFrame: () => boolean
}

export const pumped = (now: () => number = () => performance.now()): Pumped => {
  let queue: Array<(t: number) => void> = []
  return {
    requestFrame: (callback) => {
      queue.push(callback)
      return callback
    },
    cancelFrame: (handle) => {
      const at = queue.indexOf(handle)
      if (at >= 0) queue.splice(at, 1)
    },
    pump: (time) => {
      // A callback asked for during this frame waits for the next (RefreshFrameSource's rule 3).
      const due = queue
      queue = []
      for (let i = 0; i < due.length; i++) due[i](time)
    },
    wantsFrame: () => queue.length > 0,
    now,
  }
}

// --- The object writer: Motion's names, grouped per frame --------------------------------------

const DEG = Math.PI / 180

/** The minimal shape of a Three.js `Object3D` this writes: duck-typed, as Motion's adapter is. */
export interface Object3DLike {
  position: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }
  rotation: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }
  scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }
}

/** A key's own value, read from the object: Motion's `effect.read`. */
export const readKey = (o: Object3DLike, key: string): number => {
  switch (key) {
    case "x": return o.position.x
    case "y": return o.position.y
    case "z": return o.position.z
    case "rotateX": return o.rotation.x / DEG
    case "rotateY": return o.rotation.y / DEG
    case "rotateZ": return o.rotation.z / DEG
    case "scale": return o.scale.x
    case "scaleX": return o.scale.x
    case "scaleY": return o.scale.y
    case "scaleZ": return o.scale.z
    default: return (o as unknown as Record<string, number>)[key]
  }
}

/** One writer for a set of keys, built once per call: one `set` per vector a frame, nothing allocated. */
export const writerFor = (o: Object3DLike, keys: ReadonlyArray<string>): ((v: Record<string, number>) => void) => {
  const has = (k: string) => keys.includes(k)
  const pos = has("x") || has("y") || has("z")
  const rot = has("rotateX") || has("rotateY") || has("rotateZ")
  const uni = has("scale")
  const sca = has("scaleX") || has("scaleY") || has("scaleZ")
  const rest = keys.filter((k) => !/^(x|y|z|rotate[XYZ]|scale[XYZ]?)$/.test(k))
  const p = o.position, r = o.rotation, s = o.scale
  return (v) => {
    if (pos) p.set(v.x ?? p.x, v.y ?? p.y, v.z ?? p.z)
    if (rot) r.set(v.rotateX === undefined ? r.x : v.rotateX * DEG, v.rotateY === undefined ? r.y : v.rotateY * DEG, v.rotateZ === undefined ? r.z : v.rotateZ * DEG)
    if (uni) s.set(v.scale, v.scale, v.scale)
    else if (sca) s.set(v.scaleX ?? s.x, v.scaleY ?? s.y, v.scaleZ ?? s.z)
    for (let i = 0; i < rest.length; i++) (o as unknown as Record<string, number>)[rest[i]] = v[rest[i]]
  }
}

// --- animate: latest-wins per object, velocity carried ----------------------------------------

interface Running {
  token: Supersede.Supersede
  target: Record<string, number>
  value: Record<string, number>
  velocity: Record<string, number>
}

export const makeObjectEnvironment = (
  source: Pumped = pumped(),
  // Added for the perf round: a profiler's wrapped source and its loop metrics (perf/profiling.ts).
  profile?: { readonly wrap: (s: RefreshFrameSource.Shape) => RefreshFrameSource.Shape; readonly extra: Layer.Layer<never> },
) => {
  const given = (profile?.wrap ?? ((s: RefreshFrameSource.Shape) => s))(source as RefreshFrameSource.Shape)
  const base = FrameLoop.layer.pipe(
    Layer.provideMerge(Clock.layer),
    Layer.provideMerge(RefreshFrameSource.layer(given)),
  )
  const layer = profile === undefined ? base : Layer.merge(base, profile.extra)
  const runtime = ManagedRuntime.make(layer)
  const running = new WeakMap<object, Running>()

  const animate = (
    object: Object3DLike,
    target: Record<string, number>,
    options: SpringOptions = {},
  ): Promise<unknown> => {
    const before = running.get(object)
    let merged = target
    let from: Record<string, number> = {}
    let velocity: Record<string, number> = {}
    if (before !== undefined) {
      // Latest-wins: end the run before, and carry the keys this call doesn't name.
      Supersede.end(before.token)
      merged = { ...before.target, ...target }
      from = { ...before.value }
      velocity = { ...before.velocity }
    }
    for (const key in merged) if (!(key in from)) from[key] = readKey(object, key)
    const token = Supersede.make()
    const write = writerFor(object, Object.keys(merged))
    const state: Running = { token, target: merged, value: from, velocity }
    running.set(object, state)
    const machine = Machine.springValues(merged, options, { from, velocity })
    return runtime.runPromise(
      Machine.run(
        machine,
        (frame) => {
          write(frame.value)
          // The last frame's values, kept for the next call (the frame is rewritten in place).
          state.value = frame.value
          state.velocity = frame.velocity
          return undefined
        },
        { supersede: token },
      ),
    ).then((outcome) => {
      if (running.get(object) === state && !Supersede.isSuperseded(outcome)) running.delete(object)
      return outcome
    })
  }

  return { animate, source, runtime }
}
