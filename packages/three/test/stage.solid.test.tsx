// `@wardic/three/solid`'s Stage (#885's PR 1; ADR-0073 decisions 11–13 and 26, *Amendment (#885)* Q2–Q4
// and Q10), in Node with no DOM: `createStage` over a stand-in renderer, and `TestStage` as a Stage.
//
// - CS1: `frameloop: "always"` renders every frame, after Wardic's frame; a ward under the Stage moves a
//   mesh, colours in three's linear light included.
// - CS2: `frameloop: "demand"` renders its first frame, then only while something moves or after `invalidate()`.
// - CS3: a renderer factory is called once the page has settled, and a hook's input watched before then
//   connects as the canvas is made.
// - CS4: `{ wardic: made }` adopts a runtime: the hooks run on it, and the Stage runs no loop of its own.
// - CS5: the Stage ends with its owner: the loop stops and the runtime is disposed.
// - CS6: a server's Stage is inert: its ward does nothing, and `animate` is an error that says so.
// - CS7: `TestStage` is a Stage: a ward's `whileHover` and `createHover(mesh)` follow a real raycast.
// - CS8: an accessor Subject's colour is split on the Subject it gives, read untracked: no Solid diagnostic.
// - CS9: demand draws the frame a Frame effect applies in, with nothing moving: an app's own write to the
//   scene from a signal, as the scene lab's dial turns from its drag samples (#885's PR 6).
// - CS10: a ward whose key can't be written is an error naming it, as a key it lacks is, and a ward after
//   it still moves (#968).
import * as InputSource from "@wardic/core/InputSource"
import { createFrameEffect, createHover, ward, WardicStage } from "@wardic/solid"
import { createStage, TestStage } from "@wardic/three/solid"
import * as WardicThree from "@wardic/three/WardicThree"
import { inertStage, lateInput } from "../src/solid/stage.ts"
import type { JSX } from "@solidjs/web"
import { children, createRenderEffect, createRoot, createSignal, Errored, flush } from "solid-js"
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three"
import { afterEach, describe, expect, it } from "vitest"

/** What a renderer does with the tree: read it inside a root, tracked (*Amendment (#881)*, item 3). */
const disposers: Array<() => void> = []
const mountTree = (tree: () => JSX.Element): (() => void) =>
  createRoot((dispose) => {
    const resolved = children(tree)
    createRenderEffect(
      () => resolved(),
      () => undefined,
    )
    disposers.push(dispose)
    return dispose
  })
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

/** A task: what a run starts in, after the flush that started it. */
const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A renderer standing in for three's: a canvas that hears nothing, its loop the test's to run, its renders counted. */
const standIn = () => {
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), remove: () => undefined, parentElement: null })
  let loop: ((time: number) => void) | null = null
  let renders = 0
  let time = 0
  const renderer = {
    domElement: canvas as unknown as HTMLCanvasElement,
    setSize: () => undefined,
    setAnimationLoop: (callback: ((time: number) => void) | null) => {
      loop = callback
    },
    render: () => {
      renders++
    },
  }
  return {
    renderer,
    renders: () => renders,
    running: () => loop !== null,
    /** `n` frames of the loop, Solid's updates applied before each, a task waited first for a run to start. */
    frames: async (n: number): Promise<void> => {
      flush()
      await later()
      for (let i = 0; i < n; i++) {
        flush()
        time += 1000 / 60
        loop?.(time)
      }
      flush()
    },
  }
}

const sceneOf = () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
  camera.position.set(0, 0, 8)
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: "#ff0000" }))
  scene.add(mesh)
  return { scene, camera, mesh }
}

const LINEAR = { type: "tween", duration: 0.2, ease: "linear" } as const

describe("@wardic/three/solid's Stage (#885's PR 1)", () => {
  it("CS1: always renders every frame; a ward under the Stage moves a mesh, its colour in linear light", async () => {
    const { scene, camera, mesh } = sceneOf()
    const stand = standIn()
    const Crate = () => ward(mesh, { initial: { x: 0 }, animate: { x: 2, color: "#0000ff" }, transition: LINEAR }).held
    mountTree(() => {
      const stage = createStage({ renderer: stand.renderer, scene, camera })
      return (
        <WardicStage value={stage}>
          <Crate />
        </WardicStage>
      )
    })
    await stand.frames(3)
    expect(stand.renders()).toBe(3)
    await stand.frames(20)
    expect(mesh.position.x).toBeCloseTo(2, 5)
    expect(mesh.material.color.getHex()).toBe(new Color("#0000ff").getHex())
  })

  it("CS2: demand renders its first frame, then only while something moves or after invalidate()", async () => {
    const { scene, camera, mesh } = sceneOf()
    const stand = standIn()
    let stage!: ReturnType<typeof createStage>
    mountTree(() => {
      stage = createStage({ renderer: stand.renderer, scene, camera, frameloop: "demand" })
      return null
    })
    await stand.frames(5)
    expect(stand.renders(), "the first frame alone").toBe(1)
    stage.invalidate()
    await stand.frames(5)
    expect(stand.renders(), "and one after invalidate()").toBe(2)
    void stage.animate(mesh, { x: 1 }, LINEAR)
    await stand.frames(20)
    const moving = stand.renders()
    expect(moving, "a frame for each it moved").toBeGreaterThan(8)
    await stand.frames(10)
    expect(stand.renders(), "none once it's landed").toBe(moving)
  })

  it("CS9: demand draws the frame a Frame effect applies in, with nothing moving", async () => {
    const { scene, camera, mesh } = sceneOf()
    const stand = standIn()
    const [turn, setTurn] = createSignal(0)
    let drawnBefore = -1
    const Dial = () => {
      createFrameEffect(turn, (degrees) => {
        mesh.rotation.z = degrees
        drawnBefore = stand.renders()
      })
      return null
    }
    mountTree(() => {
      const stage = createStage({ renderer: stand.renderer, scene, camera, frameloop: "demand" })
      return (
        <WardicStage value={stage}>
          <Dial />
        </WardicStage>
      )
    })
    await stand.frames(5)
    expect(stand.renders(), "the first frame alone").toBe(1)
    setTurn(30)
    await stand.frames(5)
    expect(mesh.rotation.z).toBe(30)
    expect(stand.renders(), "the frame it applied in, drawn after its apply").toBe(drawnBefore + 1)
    expect(stand.renders()).toBe(2)
  })

  it("CS3: a renderer factory is made once the page has settled; an input watched before then connects", async () => {
    const source = lateInput()
    const heard: Array<string> = []
    const stop = source.source.pointer("crate")((event) => void heard.push(event.type), () => undefined)
    const cancelled = source.source.pointer("crate")((event) => void heard.push(`cancelled ${event.type}`), () => undefined)
    cancelled()
    let emit: ((event: InputSource.PointerLikeEvent) => void) | undefined
    source.attach({
      pointer: () => (next) => {
        emit = next
        return () => undefined
      },
      keyboard: () => () => () => undefined,
      focus: () => () => () => undefined,
      adoptPointer: () => ({ _tag: "None" }) as never,
    })
    emit?.(InputSource.makePointerLikeEvent({ type: "enter" }))
    expect(heard).toEqual(["enter"])
    stop()

    const { scene, camera } = sceneOf()
    const stand = standIn()
    let made = 0
    mountTree(() => {
      createStage({
        renderer: () => {
          made++
          return stand.renderer
        },
        scene,
        camera,
      })
      return null
    })
    expect(made, "not while rendering").toBe(0)
    await stand.frames(1)
    expect(made, "once settled").toBe(1)
    expect(stand.running()).toBe(true)
  })

  it("CS4: { wardic: made } adopts a runtime: the hooks run on it, and the Stage runs no loop", async () => {
    const { mesh } = sceneOf()
    const made = WardicThree.make()
    let stage!: ReturnType<typeof createStage>
    const Crate = () => ward(mesh, { animate: { x: 3 }, transition: LINEAR }).held
    mountTree(() => {
      stage = createStage({ wardic: made })
      return (
        <WardicStage value={stage}>
          <Crate />
        </WardicStage>
      )
    })
    expect(stage.wardic).toBe(made)
    flush()
    await later()
    for (let t = 16; t < 600; t += 16) made.frame(t)
    expect(mesh.position.x).toBeCloseTo(3, 5)
  })

  it("CS5: the Stage ends with its owner: its loop stops and its runtime is disposed", async () => {
    const { scene, camera } = sceneOf()
    const stand = standIn()
    const dispose = mountTree(() => {
      createStage({ renderer: stand.renderer, scene, camera })
      return null
    })
    await stand.frames(2)
    expect(stand.running()).toBe(true)
    dispose()
    expect(stand.running()).toBe(false)
  })

  it("CS6: a server's Stage is inert: its ward does nothing, and animate says why it can't", () => {
    const stage = inertStage()
    const { mesh } = sceneOf()
    const made = stage.ward(mesh, { animate: { x: 1 } })
    expect(made.settled()).toBeUndefined()
    expect(stage.isSubject(mesh)).toBe(true)
    expect(() => stage.animate(mesh, { x: 1 })).toThrow(/on a server/)
  })

  it("CS7: TestStage is a Stage: whileHover and createHover(mesh) follow a real raycast", async () => {
    const { scene, camera, mesh } = sceneOf()
    const stage = TestStage.make({ scene, camera, size: { width: 800, height: 600 } })
    let hovered!: () => boolean
    const Crate = () => {
      hovered = createHover(mesh)
      return ward(mesh, { whileHover: { scale: 1.2 }, transition: LINEAR }).held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    flush()
    await later()
    stage.frame()
    stage.pointer.over(mesh)
    for (let i = 0; i < 3; i++) stage.frame()
    flush()
    expect(hovered()).toBe(true)
    await later()
    for (let i = 0; i < 20; i++) stage.frame()
    expect(mesh.scale.x).toBeCloseTo(1.2, 5)
  })

  it("CS8: an accessor Subject's colour is split on the Subject it gives, with no Solid diagnostic", async () => {
    const said: Array<string> = []
    const warn = console.warn
    const error = console.error
    console.warn = (...args: Array<unknown>) => void said.push(String(args[0]))
    console.error = (...args: Array<unknown>) => void said.push(String(args[0]))
    try {
      const { scene, camera, mesh } = sceneOf()
      const stand = standIn()
      const [subject] = createSignal<Mesh | undefined>(mesh)
      const Crate = () => ward(subject, { animate: { color: "#0000ff" }, transition: LINEAR }).held
      mountTree(() => {
        const stage = createStage({ renderer: stand.renderer, scene, camera })
        return (
          <WardicStage value={stage}>
            <Crate />
          </WardicStage>
        )
      })
      await stand.frames(20)
      expect(mesh.material.color.getHex()).toBe(new Color("#0000ff").getHex())
    } finally {
      console.warn = warn
      console.error = error
    }
    expect(said).toEqual([])
  })

  it("CS10: a ward whose key can't be written is an error naming it, as a key it lacks is, and a ward after it still moves (#968)", async () => {
    const { mesh } = sceneOf()
    const other = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    const made = WardicThree.make()
    const said: Array<string> = []
    const log = console.log
    console.log = (...args: Array<unknown>) => void said.push(args.map(String).join(" "))
    let caught = ""
    try {
      // The mesh's `id` first: before #968, its write threw each frame and the flush stopped there.
      const Stuck = () => ward(mesh, { animate: { id: 5 } as never, transition: LINEAR }).held
      const Crate = () => ward(other, { animate: { x: 3 }, transition: LINEAR }).held
      mountTree(() => (
        <WardicStage value={createStage({ wardic: made })}>
          <Errored
            fallback={(err) => {
              caught = String((err() as Error).message)
              return null
            }}
          >
            <Stuck />
          </Errored>
          <Crate />
        </WardicStage>
      ))
      flush()
      await later()
      for (let t = 16; t < 600; t += 16) made.frame(t)
    } finally {
      console.log = log
    }
    expect(caught).toMatch(/a Mesh's "id" can't be written/)
    expect(other.position.x).toBeCloseTo(3, 5)
    expect(said.filter((line) => line.includes("a flush failed"))).toEqual([])
  })
})
