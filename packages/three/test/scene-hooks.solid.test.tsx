// A scene's hooks alone (#927; ADR-0073, *Amendment (#885)*'s #927 note): `@wardic/three/solid`'s `ward`,
// `createBatch`, `createHover`, `createPress` and `createDrag`, `@wardic/solid`'s Stage halves, on
// `TestStage` in Node with no DOM.
//
// - SH1: `ward(mesh, …)` shows its `initial` in the first frame and lands its `animate`.
// - SH2: `ward` needs a `<WardicStage>`, and a page's element is `@wardic/solid`'s.
// - SH3: `createHover(mesh)` and `createPress(mesh)` follow the pointer through the scene's raycast.
// - SH4: `createDrag(mesh)` reads its drag's samples, and moves nothing.
// - SH5: `createBatch({ object })` makes its members in the scene and moves them.
// - SH6: a sensor given a page's element says to import it from `@wardic/solid`.
import { createBatch, createDrag, createHover, createPress, stageBatches, TestStage, ward, WardicStage } from "@wardic/three/solid"
import type * as Drag from "@wardic/core/Drag"
import type { JSX } from "@solidjs/web"
import { type Accessor, children, createRenderEffect, createRoot, flush } from "solid-js"
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three"
import { afterEach, describe, expect, it } from "vitest"

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

const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const LINEAR = { type: "tween", duration: 0.2, ease: "linear" } as const
const meshOf = () => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())

const stageOf = () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
  camera.position.set(0, 0, 8)
  camera.updateMatrixWorld()
  const mesh = meshOf()
  scene.add(mesh)
  const stage = TestStage.make({ scene, camera, size: { width: 800, height: 600 }, features: [stageBatches] })
  const frames = async (n: number): Promise<void> => {
    flush()
    await later()
    for (let i = 0; i < n; i++) {
      flush()
      stage.frame()
    }
    flush()
  }
  return { scene, mesh, stage, frames }
}

/** `body` run in a component under `stage`, mounted. */
const under = (stage: TestStage.TestStage, body: () => void): void => {
  const Hooks = () => {
    body()
    return null
  }
  mountTree(() => (
    <WardicStage value={stage}>
      <Hooks />
    </WardicStage>
  ))
}

/** What `body` throws, run under an owner. */
const thrownBy = (body: () => void): unknown => {
  let thrown: unknown
  createRoot((dispose) => {
    try {
      body()
    } catch (error) {
      thrown = error
    }
    dispose()
  })
  return thrown
}

/** A stand-in for a page's element: what the hooks tell one by, its `nodeType`. */
const ELEMENT = { nodeType: 1 } as unknown as Mesh

describe("a scene's hooks alone (#927)", () => {
  it("SH1: ward(mesh, …) shows its initial in the first frame and lands its animate", async () => {
    const { mesh, stage, frames } = stageOf()
    under(stage, () => void ward(mesh, { initial: { x: -1 }, animate: { x: 2 }, transition: LINEAR }))
    flush()
    stage.frame()
    expect(mesh.position.x, "its initial, in the first frame").toBeCloseTo(-1, 5)
    await frames(20)
    expect(mesh.position.x).toBeCloseTo(2, 5)
  })

  it("SH2: ward needs a <WardicStage>, and a page's element is @wardic/solid's", () => {
    const { stage } = stageOf()
    expect(String(thrownBy(() => ward(meshOf(), { animate: { x: 1 } })))).toMatch(/no <WardicStage> is above it/)
    let refused: unknown
    under(stage, () => {
      try {
        ward(ELEMENT, { animate: { x: 1 } })
      } catch (error) {
        refused = error
      }
    })
    expect(String(refused)).toMatch(/import ward from @wardic\/solid/)
  })

  it("SH3: createHover(mesh) and createPress(mesh) follow the pointer through the scene's raycast", async () => {
    const { mesh, stage, frames } = stageOf()
    let hovered!: Accessor<boolean>
    let pressed!: Accessor<boolean>
    under(stage, () => {
      hovered = createHover(mesh)
      pressed = createPress(mesh)
    })
    await frames(1)
    expect([hovered(), pressed()]).toEqual([false, false])
    stage.pointer.over(mesh)
    await frames(1)
    expect(hovered()).toBe(true)
    stage.pointer.down()
    await frames(1)
    expect(pressed()).toBe(true)
    stage.pointer.up()
    await frames(1)
    expect(pressed()).toBe(false)
  })

  it("SH4: createDrag(mesh) reads its drag's samples and moves nothing", async () => {
    const { mesh, stage, frames } = stageOf()
    let sample!: Accessor<Drag.Sample | null>
    under(stage, () => {
      sample = createDrag(mesh)
    })
    await frames(1)
    stage.pointer.over(mesh)
    await frames(1)
    const { x, y } = stage.pointer.position()
    stage.pointer.down()
    await frames(1)
    for (let i = 1; i <= 3; i++) {
      stage.pointer.at(x + 20 * i, y)
      await frames(1)
    }
    expect(sample()?.phase).toBe("move")
    expect(sample()?.offset.x).toBeCloseTo(60, 0)
    expect(mesh.position.x, "a sensor moves nothing").toBe(0)
  })

  it("SH5: createBatch({ object }) makes its members in the scene and moves them", async () => {
    const { scene, stage, frames } = stageOf()
    const made: Array<Mesh> = []
    under(stage, () => {
      createBatch({
        count: 3,
        object: () => {
          const one = meshOf()
          made.push(one)
          return one
        },
        animate: (i) => ({ x: i * 2 }),
        transition: LINEAR,
      })
    })
    await frames(20)
    expect(made.map((one) => one.parent)).toEqual([scene, scene, scene])
    expect(made.map((one) => one.position.x)).toEqual([0, 2, 4])
  })

  it("SH6: a sensor given a page's element says to import it from @wardic/solid", () => {
    const { stage } = stageOf()
    const refused: Array<string> = []
    under(stage, () => {
      for (const sense of [createHover, createPress, createDrag]) {
        try {
          sense(ELEMENT)
        } catch (error) {
          refused.push(String(error))
        }
      }
    })
    expect(refused).toHaveLength(3)
    for (const said of refused) expect(said).toMatch(/import create(Hover|Press|Drag) from @wardic\/solid/)
  })
})
