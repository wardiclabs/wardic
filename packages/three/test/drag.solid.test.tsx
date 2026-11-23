// Drag in 3D (#885's PR 4; ADR-0070 decision 9, kept by ADR-0073 decision 18, *Amendment (#885)* Q8), a
// ward's `drag` on `TestStage`'s pointer, in Node with no DOM. The camera at z 8, 45° high on an 800 by
// 600 canvas: the drag grabs the box's face at z 0.5, and moves on a plane through it, where a world unit
// is `PX` pixels.
//
// - DR1: `drag: true` moves the mesh on the plane facing the camera, through the point grabbed.
// - DR2: `drag: "y"` moves it along its parent's y alone, a diagonal pointer's other part dropped.
// - DR3: `dragPlane` moves it on the ground: its y stays where it is.
// - DR4: `dragConstraints` with `dragElastic`: pulled past its range by half the overshoot, and back
//   within it at the release.
// - DR5: `dragSnapToOrigin` takes it back where it was picked up.
// - DR6: momentum: a flick glides on past the release, and `dragTransitionEnd` tells its rest.
// - DR7: `whileDrag` is on through the drag, with `dragStart` and `dragEnd`.
// - DR8: `createDrag(mesh)` reads its pointer samples.
// - DR9: the drag holds `x` where it leaves it until the ward's own target for `x` changes.
import { createDrag, type StageWard, type StageWardConfig, ward, WardicStage } from "@wardic/solid"
import { TestStage } from "@wardic/three/solid"
import type * as Drag from "@wardic/core/Drag"
import type { JSX } from "@solidjs/web"
import { type Accessor, children, createRenderEffect, createRoot, createSignal, flush } from "solid-js"
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, Scene, Vector3 } from "three"
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

/** A world unit at the box's face, z 0.5, in pixels, through the camera at z 8. */
const PX = 600 / (2 * 7.5 * Math.tan(Math.PI / 8))

const stageOf = (place?: (camera: PerspectiveCamera) => void) => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
  camera.position.set(0, 0, 8)
  if (place !== undefined) place(camera)
  camera.updateMatrixWorld()
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
  scene.add(mesh)
  const stage = TestStage.make({ scene, camera, size: { width: 800, height: 600 } })
  const frames = async (n: number): Promise<void> => {
    flush()
    await later()
    for (let i = 0; i < n; i++) {
      flush()
      stage.frame()
    }
    flush()
  }
  /** The pointer down on the mesh, moved by `dx`, `dy` pixels over `steps` frames; let go unless `hold`. */
  const dragBy = async (dx: number, dy: number, steps = 4, hold = false): Promise<void> => {
    stage.pointer.over(mesh)
    await frames(1)
    const { x, y } = stage.pointer.position()
    stage.pointer.down()
    await frames(1)
    for (let i = 1; i <= steps; i++) {
      stage.pointer.at(x + (dx * i) / steps, y + (dy * i) / steps)
      await frames(1)
    }
    if (hold) return
    stage.pointer.up()
    await frames(1)
  }
  return { scene, camera, mesh, stage, frames, dragBy }
}

/** `config`'s ward on the stage's mesh, mounted. */
const wardOn = (setup: ReturnType<typeof stageOf>, config: StageWardConfig): Accessor<StageWard> => {
  let made!: StageWard
  const Crate = () => {
    made = ward(setup.mesh, config as never)
    return made.held
  }
  mountTree(() => (
    <WardicStage value={setup.stage}>
      <Crate />
    </WardicStage>
  ))
  return () => made
}

describe("drag in 3D (#885's PR 4)", () => {
  it("DR1: drag: true moves it on the plane facing the camera, through the point grabbed", async () => {
    const setup = stageOf()
    wardOn(setup, { drag: true, dragMomentum: false })
    await setup.frames(2)
    await setup.dragBy(2 * PX, -1 * PX)
    await setup.frames(10)
    expect(setup.mesh.position.x).toBeCloseTo(2, 1)
    expect(setup.mesh.position.y).toBeCloseTo(1, 1)
    expect(setup.mesh.position.z).toBeCloseTo(0, 5)
  })

  it("DR2: drag: 'y' moves it along its parent's y alone", async () => {
    const setup = stageOf()
    wardOn(setup, { drag: "y", dragMomentum: false })
    await setup.frames(2)
    await setup.dragBy(1.5 * PX, -1 * PX)
    await setup.frames(10)
    expect(setup.mesh.position.x).toBe(0)
    expect(setup.mesh.position.y).toBeCloseTo(1, 1)
    expect(setup.mesh.position.z).toBe(0)
  })

  it("DR3: dragPlane moves it on the ground: its y stays", async () => {
    const setup = stageOf((camera) => {
      camera.position.set(0, 6, 6)
      camera.lookAt(0, 0, 0)
    })
    wardOn(setup, { drag: true, dragPlane: new Plane(new Vector3(0, 1, 0), 0), dragMomentum: false })
    await setup.frames(2)
    await setup.dragBy(80, -40)
    await setup.frames(10)
    expect(setup.mesh.position.x).toBeGreaterThan(0.4)
    expect(setup.mesh.position.z, "up the screen is away, on the ground").toBeLessThan(-0.2)
    expect(setup.mesh.position.y).toBeCloseTo(0, 6)
  })

  it("DR4: dragConstraints with dragElastic: past its range by half the overshoot, back within it at the release", async () => {
    const setup = stageOf()
    wardOn(setup, { drag: "x", dragConstraints: { x: [-1, 1] }, dragElastic: 0.5, dragMomentum: false })
    await setup.frames(2)
    await setup.dragBy(3 * PX, 0, 4, true)
    expect(setup.mesh.position.x, "1 + (3 - 1) × 0.5").toBeCloseTo(2, 1)
    setup.stage.pointer.up()
    await setup.frames(90)
    expect(setup.mesh.position.x).toBeCloseTo(1, 2)
  })

  it("DR5: dragSnapToOrigin takes it back where it was picked up", async () => {
    const setup = stageOf()
    wardOn(setup, { drag: true, dragSnapToOrigin: true })
    await setup.frames(2)
    await setup.dragBy(2 * PX, 0)
    expect(setup.mesh.position.x).toBeGreaterThan(1)
    await setup.frames(120)
    expect(setup.mesh.position.x).toBeCloseTo(0, 2)
  })

  it("DR6: momentum: a flick glides on past its release, and dragTransitionEnd tells its rest", async () => {
    const setup = stageOf()
    const card = wardOn(setup, { drag: "x" })
    await setup.frames(2)
    const rested = card().next("dragTransitionEnd")
    await setup.dragBy(1 * PX, 0, 2)
    const released = setup.mesh.position.x
    await setup.frames(60)
    expect(setup.mesh.position.x, "on past where it was let go").toBeGreaterThan(released + 0.3)
    // Its glide comes to rest within the scene's thresholds: pumped until it does.
    let rest = false
    void rested.then(() => (rest = true))
    for (let i = 0; i < 20 && !rest; i++) await setup.frames(60)
    expect(rest).toBe(true)
  })

  it("DR7: whileDrag is on through the drag, with dragStart and dragEnd", async () => {
    const setup = stageOf()
    const card = wardOn(setup, { drag: true, dragMomentum: false, whileDrag: { scale: 1.2 }, transition: LINEAR })
    await setup.frames(2)
    const heard: Array<string> = []
    void card().next("dragStart").then(() => heard.push("dragStart"))
    void card().next("dragEnd").then(() => heard.push("dragEnd"))
    await setup.dragBy(PX, 0, 4, true)
    await setup.frames(20)
    expect(setup.mesh.scale.x).toBeCloseTo(1.2, 5)
    expect(heard).toEqual(["dragStart"])
    setup.stage.pointer.up()
    await setup.frames(20)
    expect(setup.mesh.scale.x).toBeCloseTo(1, 5)
    expect(heard).toEqual(["dragStart", "dragEnd"])
  })

  it("DR8: createDrag(mesh) reads its pointer samples", async () => {
    const setup = stageOf()
    let sample!: Accessor<Drag.Sample | null>
    const Crate = () => {
      sample = createDrag(setup.mesh)
      return null
    }
    mountTree(() => (
      <WardicStage value={setup.stage}>
        <Crate />
      </WardicStage>
    ))
    await setup.frames(2)
    expect(sample()).toBeNull()
    await setup.dragBy(60, 0, 3, true)
    expect(sample()?.phase).toBe("move")
    expect(sample()?.offset.x).toBeCloseTo(60, 0)
    expect(setup.mesh.position.x, "a sensor moves nothing").toBe(0)
  })

  it("DR9: the drag holds x where it leaves it until the ward's own target for x changes", async () => {
    const setup = stageOf()
    const [x, setX] = createSignal(0)
    wardOn(setup, { drag: "x", dragMomentum: false, animate: () => ({ x: x() }), transition: LINEAR })
    await setup.frames(2)
    await setup.dragBy(2 * PX, 0)
    await setup.frames(20)
    expect(setup.mesh.position.x).toBeCloseTo(2, 1)
    setX(-1)
    await setup.frames(20)
    expect(setup.mesh.position.x).toBeCloseTo(-1, 5)
  })
})
