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
// - SH7: a ward's config names a material's own values, `StageValues` (#934), and a misspelt one is a type error.
// - SH8: a ward's `read` gives its Subject's keys at their types, from the Subject's own values until moved (#939).
// - SH9: on a server, a ward's `read` gives its Subject's own values (#939).
import { createBatch, createDrag, createHover, createPress, createSceneObject, stageBatches, TestStage, ward, WardicStage } from "@wardic/three/solid"
import type * as Drag from "@wardic/core/Drag"
import type { JSX } from "@solidjs/web"
import { type Accessor, children, createRenderEffect, createRoot, createSignal, flush } from "solid-js"
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, Scene } from "three"
import { afterEach, describe, expect, expectTypeOf, it } from "vitest"
import { inertWardOn } from "../src/solid/stage.ts"

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

  it("SH7: a ward's config names a material's own values, and a misspelt one is a type error", async () => {
    const { scene, stage, frames } = stageOf()
    const glazed = new Mesh(new BoxGeometry(1, 1, 1), new MeshPhysicalMaterial({ roughness: 1, clearcoat: 0 }))
    scene.add(glazed)
    under(stage, () => void ward(glazed, { animate: { roughness: 0.25, clearcoat: 1 }, transition: LINEAR }))
    await frames(20)
    expect(glazed.material.roughness).toBeCloseTo(0.25, 5)
    expect(glazed.material.clearcoat).toBeCloseTo(1, 5)
    // Types alone, never run: a name in neither an element's values nor three's.
    const misspelt = () => {
      // @ts-expect-error `roughnes` is no value Wardic animates.
      ward(glazed, { animate: { roughnes: 0.25 } })
    }
    void misspelt
  })

  it("SH8: a ward's read gives its Subject's keys at their types, from its own values until moved (#939)", async () => {
    const { scene, stage, frames } = stageOf()
    // A number of the app's own on a scene object, which a Stage animates as any other.
    class Kiln extends Group {
      heat = 20
    }
    const kiln = new Kiln()
    const glazed = new Mesh(new BoxGeometry(1, 1, 1), new MeshPhysicalMaterial({ roughness: 1, clearcoat: 0.5 }))
    scene.add(kiln, glazed)
    const [later, setLater] = createSignal<Kiln | undefined>()
    let heat!: Accessor<number>
    let clearcoat!: Accessor<number>
    let roughness!: Accessor<number>
    let pending!: Accessor<number | undefined>
    let nothing!: Accessor<number | string | undefined>
    let joined!: Accessor<number>
    under(stage, () => {
      heat = ward(kiln, {}).read("heat")
      clearcoat = ward(glazed, {}).read("clearcoat")
      const driven = ward(glazed, { animate: { roughness: 0.25 }, transition: LINEAR })
      roughness = driven.read("roughness")
      nothing = driven.read("nothing")
      pending = ward(later, {}).read("heat")
      joined = createSceneObject(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()), { initial: { y: 2 } }).read("y")
    })
    // Types alone: a key its Subject has, at its type; `undefined` only while an accessor gives no Subject.
    expectTypeOf(heat).toEqualTypeOf<Accessor<number>>()
    expectTypeOf(clearcoat).toEqualTypeOf<Accessor<number>>()
    expectTypeOf(roughness).toEqualTypeOf<Accessor<number>>()
    expectTypeOf(pending).toEqualTypeOf<Accessor<number | undefined>>()
    expectTypeOf(nothing).toEqualTypeOf<Accessor<number | string | undefined>>()
    expectTypeOf(joined).toEqualTypeOf<Accessor<number>>()
    flush()
    stage.frame()
    expect([heat(), clearcoat(), roughness(), joined()], "each Subject's own value, or its initial, before anything moves it").toEqual([20, 0.5, 1, 2])
    expect([pending(), nothing()], "no Subject yet; a key it doesn't have").toEqual([undefined, undefined])
    void stage.animate(kiln, { heat: 1240 }, LINEAR)
    setLater(kiln)
    await frames(20)
    expect([heat(), roughness(), pending()], "followed as the Stage moves it").toEqual([1240, 0.25, 1240])
    expect(clearcoat(), "unmoved").toBe(0.5)
  })

  it("SH9: on a server, a ward's read gives its Subject's own values (#939)", () => {
    const glazed = new Mesh(new BoxGeometry(1, 1, 1), new MeshPhysicalMaterial({ clearcoat: 0.5 }))
    glazed.position.y = 3
    const server = inertWardOn(glazed)
    const read = (key: string): unknown => (server.read as (key: string) => Accessor<unknown>)(key)()
    expect([read("y"), read("clearcoat"), read("nothing")]).toEqual([3, 0.5, undefined])
    expect((inertWardOn(() => undefined).read as (key: string) => Accessor<unknown>)("y")(), "an accessor giving none").toBeUndefined()
  })
})
