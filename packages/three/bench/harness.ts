/**
 * Three's frame bench (#883's PR 5b, ADR-0073 decision 27): `@wardic/three`'s time a frame with N meshes
 * or instances, through `wardic.frame(t)`, the Host loop's call.
 *
 * - **A Batch against a run each:** N meshes in one Batch, and each in its own run, at N and ten times N.
 * - **Instances against meshes' own matrices:** an `InstancedMesh`'s Batch writes its instances' matrices;
 *   three's own way is a matrix each, `scene.updateMatrixWorld()` (`three/matrices x10`, which runs only
 *   three's code, the same on both sides: the noise control).
 * - **The raycast a frame:** the scene's input over ten times N meshes, and over ten times N instances, a
 *   hover watched and the pointer still over the scene.
 * - **Empty Frame effects:** a hundred times N `afterWrites` effects that do nothing, nothing moving: an
 *   effect's cost a frame, about a nanosecond, whose target is no bytes.
 * - **The Solid hooks** (`@wardic/three/solid`, #885's PR 6), each under a Stage over a runtime the bench
 *   pumps (`createStage({ wardic })`): N meshes each a bare `ward(mesh, …)`, against N each a
 *   `createSceneObject(mesh, …)` joining the scene, for what a Scene object's membership costs; and a
 *   hundred times N empty `createFrameEffect`s, nothing moving, whose target is no bytes a frame.
 *
 * A workload under 0.1 ms a frame at N runs at ten times N (`x10`), as bench:core's do (#545), or a hundred.
 *
 * Every animation is a tween long enough to move every member through every measured frame. `run.ts` builds
 * one bundle of this file per side, its core, object and three, and runs them in Bun and Node.
 */
// ADR-0073 decision 27 and *Amendment (#883)*, PR 5's Q7. The driver and its gate are bench:core's
// (`packages/core/bench/driver.ts`). The Solid hooks' cases are *Amendment (#885)*'s Q13: the driver
// gives them a side's own `@wardic/three/solid` and `@wardic/solid` (`run.ts`'s `modules`).
import type * as SolidModule from "@wardic/solid"
import { children, createComponent, createRenderEffect, createRoot, flush } from "solid-js"
import * as THREE from "three"
import type { Options, WorkloadResult } from "../../core/bench/harness.ts"
import type * as ThreeModule from "../src/index.ts"
import type * as StageModule from "../src/solid.ts"

type Three = typeof ThreeModule

/** A side's Solid hooks, where it has them: its `@wardic/three/solid` and its `@wardic/solid`. */
interface Hooks {
  readonly stage?: typeof StageModule
  readonly solid?: typeof SolidModule
}

/** A host hook for allocations: Node with `--expose-gc` (core's `one.mjs`). */
interface Mem {
  readonly gc: () => void
  readonly allocated: () => number
}

/** No heap hook: Bun reports no allocations. */
const NO_MEM: Mem = { gc: () => {}, allocated: () => 0 }

/** A workload's scene, set up and started: what one frame runs, and its end. */
interface Scenario {
  readonly frame: (time: number) => void
  readonly dispose: () => void
}

interface Workload {
  readonly name: string
  /** Meshes or instances per element of N: ten for a workload at ten times N. */
  readonly scale?: number
  /** Whether a side has what it runs: one a base lacks is reported as new. */
  readonly runsOn?: (three: Three, hooks: Hooks) => boolean
  /** Its scene at `n`, its runtime made and its animation started. */
  readonly make: (three: Three, n: number, hooks: Hooks) => Scenario
}

/** Long enough to move every member through every measured frame. */
const LONG = { type: "tween", duration: 1000, ease: "linear" } as const

const GEOMETRY = new THREE.BoxGeometry(0.8, 0.8, 0.8)
const MATERIAL = new THREE.MeshBasicMaterial()

/** The side of a square grid of `n`. */
const sideOf = (n: number): number => Math.ceil(Math.sqrt(n))

/** `n` meshes in a grid, in `scene`. */
const meshesIn = (scene: THREE.Object3D, n: number): Array<THREE.Mesh> => {
  const side = sideOf(n)
  return Array.from({ length: n }, (_, i) => {
    const mesh = new THREE.Mesh(GEOMETRY, MATERIAL)
    mesh.position.set((i % side) - side / 2, Math.floor(i / side) - side / 2, 0)
    scene.add(mesh)
    return mesh
  })
}

/** An `InstancedMesh` of `n` instances in a grid, in `scene`. */
const instancesIn = (scene: THREE.Object3D, n: number): THREE.InstancedMesh => {
  const side = sideOf(n)
  const mesh = new THREE.InstancedMesh(GEOMETRY, MATERIAL, n)
  const matrix = new THREE.Matrix4()
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, matrix.makeTranslation((i % side) - side / 2, Math.floor(i / side) - side / 2, 0))
  mesh.computeBoundingSphere()
  scene.add(mesh)
  return mesh
}

/** A runtime's frame and end, as a scenario. */
const scenarioOf = (wardic: ThreeModule.WardicThree.WardicThree): Scenario => ({ frame: wardic.frame, dispose: wardic.dispose })

/**
 * A runtime on a stand-in canvas of 800 × 600 over `scene`, from a camera seeing a grid of `n`, the
 * pointer still over its middle, and `hover` watched on `subject`.
 */
const pointedAt = (three: Three, scene: THREE.Scene, n: number, subject: object): Scenario => {
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) })
  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000)
  camera.position.z = sideOf(n) * 1.2
  scene.updateMatrixWorld()
  camera.updateMatrixWorld()
  const wardic = three.WardicThree.make({ canvas, camera, scene, window: new EventTarget() })
  wardic.hover(subject, () => {})
  const fields = { clientX: 400, clientY: 300, pointerId: 1, pointerType: "mouse", isPrimary: true, button: -1, buttons: 0, timeStamp: 0 }
  for (const type of ["pointerenter", "pointermove"]) {
    canvas.dispatchEvent(Object.defineProperties(new Event(type), Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }]))))
  }
  return scenarioOf(wardic)
}

const hasInstances = (three: Three): boolean => "ThreeInstances" in three
const hasInput = (three: Three): boolean => "ThreeInput" in three

/** A Batch of `n` meshes moving `y` and `rotateY`. */
const meshBatch = (three: Three, n: number): Scenario => {
  const wardic = three.WardicThree.make()
  wardic.animate(wardic.batch(meshesIn(new THREE.Scene(), n)), { y: (i) => i % 7, rotateY: 360 }, LONG)
  return scenarioOf(wardic)
}

/** `n` meshes moving `y` and `rotateY`, each in its own run. */
const meshEach = (three: Three, n: number): Scenario => {
  const wardic = three.WardicThree.make()
  wardic.animate(meshesIn(new THREE.Scene(), n), { y: 7, rotateY: 360 }, LONG)
  return scenarioOf(wardic)
}

/** An `InstancedMesh`'s Batch of `n` moving `y` and `rotateY`. */
const instanceBatch = (three: Three, n: number): Scenario => {
  const wardic = three.WardicThree.make()
  wardic.animate(wardic.batch(instancesIn(new THREE.Scene(), n)), { y: (i) => i % 7, rotateY: 360 }, LONG)
  return scenarioOf(wardic)
}

const hasHooks = (_three: Three, hooks: Hooks): boolean => hooks.stage !== undefined && hooks.solid !== undefined

/** `n` of `Item`'s components, each given its index, under a Stage over a runtime the bench pumps, mounted and flushed. */
const staged = (three: Three, hooks: Hooks, n: number, Item: (props: { readonly i: number }) => null): Scenario => {
  const { stage: kit } = hooks as Required<Hooks>
  const wardic = three.WardicThree.make()
  const unmount = createRoot((dispose) => {
    const stage = kit.createStage({ wardic })
    // `<WardicStage value={stage}>{indices.map((i) => <Item i={i} />)}</WardicStage>`, compiled by hand.
    const tree = children(() =>
      createComponent(kit.WardicStage, {
        value: stage,
        get children() {
          return Array.from({ length: n }, (_, i) => createComponent(Item, { i }))
        },
      }),
    )
    createRenderEffect(
      () => tree(),
      () => undefined,
    )
    return dispose
  })
  flush()
  return {
    frame: wardic.frame,
    dispose: () => {
      unmount()
      wardic.dispose()
    },
  }
}

const MOVING = { animate: { y: 7, rotateY: 360 }, transition: LONG } as const

const WORKLOADS: ReadonlyArray<Workload> = [
  {
    // three's own code alone, the same on both sides: the noise control.
    name: "three/matrices x10",
    scale: 10,
    make: (_three, n) => {
      const scene = new THREE.Scene()
      const meshes = meshesIn(scene, n)
      return {
        frame: () => {
          for (const mesh of meshes) mesh.rotation.y += 0.01
          scene.updateMatrixWorld()
        },
        dispose: () => {},
      }
    },
  },
  { name: "meshes/batch", make: meshBatch },
  { name: "meshes/batch x10", scale: 10, make: meshBatch },
  { name: "meshes/each", make: meshEach },
  { name: "meshes/each x10", scale: 10, make: meshEach },
  { name: "instances/batch", runsOn: hasInstances, make: instanceBatch },
  { name: "instances/batch x10", scale: 10, runsOn: hasInstances, make: instanceBatch },
  {
    name: "raycast/meshes x10",
    scale: 10,
    runsOn: hasInput,
    make: (three, n) => {
      const scene = new THREE.Scene()
      const meshes = meshesIn(scene, n)
      return pointedAt(three, scene, n, meshes[0]!)
    },
  },
  {
    name: "raycast/instances x10",
    scale: 10,
    runsOn: hasInput,
    make: (three, n) => {
      const scene = new THREE.Scene()
      return pointedAt(three, scene, n, instancesIn(scene, n))
    },
  },
  {
    name: "afterWrites x100",
    scale: 100,
    make: (three, n) => {
      const wardic = three.WardicThree.make()
      for (let i = 0; i < n; i++) wardic.afterWrites(() => {})
      return scenarioOf(wardic)
    },
  },
  {
    // A bare ward on each of N meshes in the scene: what a Scene object's membership is measured against.
    name: "stage/ward",
    runsOn: hasHooks,
    make: (three, n, hooks) => {
      const { solid } = hooks as Required<Hooks>
      const meshes = meshesIn(new THREE.Scene(), n)
      return staged(three, hooks, n, (props) => {
        solid.ward(meshes[props.i]!, MOVING)
        return null
      })
    },
  },
  {
    // N Scene objects, each joining the scene as its ward starts.
    name: "stage/sceneObject",
    runsOn: hasHooks,
    make: (three, n, hooks) => {
      const { stage } = hooks as Required<Hooks>
      const scene = new THREE.Scene()
      const meshes = meshesIn(new THREE.Scene(), n)
      return staged(three, hooks, n, (props) => {
        stage.createSceneObject(meshes[props.i]!, { parent: scene, ...MOVING })
        return null
      })
    },
  },
  {
    // A hundred times N empty Frame effects, nothing moving: each frame, each one's check that it isn't due.
    name: "stage/frameEffect x100",
    scale: 100,
    runsOn: hasHooks,
    make: (three, n, hooks) => {
      const { solid } = hooks as Required<Hooks>
      return staged(three, hooks, n, () => {
        solid.createFrameEffect(
          () => undefined,
          () => undefined,
        )
        return null
      })
    },
  },
]

const quantile = (xs: ReadonlyArray<number>, p: number): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!

/** One round of `workload`: its start, through its first frame, then `warm` frames, then `frames` timed. */
const runRound = async (three: Three, hooks: Hooks, workload: Workload, options: Options): Promise<{ readonly times: Array<number>; readonly startMs: number; readonly bytes: Array<number> }> => {
  const n = options.n * (workload.scale ?? 1)
  let time = 1000
  const t0 = performance.now()
  const scenario = workload.make(three, n, hooks)
  // An animation starts a microtask after its call.
  for (let i = 0; i < 3; i++) await Promise.resolve()
  scenario.frame(time)
  const startMs = performance.now() - t0
  const step = (): void => {
    time += 1000 / 60
    scenario.frame(time)
  }
  for (let f = 0; f < options.warm; f++) step()
  const mem: Mem = (globalThis as { readonly __mem?: Mem }).__mem ?? NO_MEM
  mem.gc()
  const allocated0 = mem.allocated()
  const times: Array<number> = []
  for (let f = 0; f < options.frames; f++) {
    const f0 = performance.now()
    step()
    times.push(performance.now() - f0)
  }
  const bytes: Array<number> = []
  if (mem !== NO_MEM) bytes.push((mem.allocated() - allocated0) / options.frames)
  scenario.dispose()
  return { times, startMs, bytes }
}

/**
 * Run every workload against `three`, a side's `@wardic/three`, and `hooks`, its Solid hooks where it has
 * them; registered on `globalThis.__wardicBench` for the driver.
 */
export const register = (three: Three, hooks: Hooks = {}): void => {
  ;(globalThis as Record<string, unknown>).__wardicBench = async (options: Options): Promise<Record<string, WorkloadResult>> => {
    const out: Record<string, WorkloadResult> = {}
    for (const workload of WORKLOADS) {
      if (workload.runsOn !== undefined && !workload.runsOn(three, hooks)) continue
      const times: Array<number> = []
      const starts: Array<number> = []
      const bytes: Array<number> = []
      for (let r = 0; r < options.rounds; r++) {
        const round = await runRound(three, hooks, workload, options)
        if (r === 0) continue
        times.push(...round.times)
        starts.push(round.startMs)
        bytes.push(...round.bytes)
      }
      const result: { -readonly [K in keyof WorkloadResult]: WorkloadResult[K] } = {
        runs: options.n * (workload.scale ?? 1),
        frameMs: quantile(times, 0.5),
        p95Ms: quantile(times, 0.95),
        startMs: quantile(starts, 0.5),
      }
      if (bytes.length > 0) result.bytesPerFrame = quantile(bytes, 0.5)
      out[workload.name] = result
    }
    return out
  }
}
