/**
 * The scene's input (#883's PR 5a; ADR-0069 decisions 22 and 23, ADR-0073 *Amendment (#883)*, PR 5's
 * Q3–Q6): `hover` and `press` on a scene's objects, a Batch's members and an `InstancedMesh`'s instances,
 * hit by three's real raycast, driven through `TestStage`. Node, no page.
 */
import * as TestStage from "@wardic/three/TestStage"
import * as ThreeInput from "@wardic/three/ThreeInput"
import * as WardicThree from "@wardic/three/WardicThree"
import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"

const SIZE = { width: 800, height: 600 } as const

/** A scene of its own, a camera at z = 10 looking down -z, and a stage on them. */
const staged = (extra: Partial<TestStage.Options> = {}): { readonly stage: TestStage.TestStage; readonly scene: THREE.Scene; readonly camera: THREE.PerspectiveCamera } => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, SIZE.width / SIZE.height, 0.1, 100)
  camera.position.z = 10
  return { stage: TestStage.make({ scene, camera, size: SIZE, ...extra }), scene, camera }
}

/** A unit box at `x`, `y`, `z`, in `scene`. */
const boxAt = (scene: THREE.Object3D, x: number, y = 0, z = 0, name = "box"): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  mesh.name = name
  mesh.position.set(x, y, z)
  scene.add(mesh)
  return mesh
}

/** A record of a gesture's starts and ends. */
const journal = () => {
  const told: Array<string> = []
  return {
    told,
    hover: (name: string): ThreeInput.HoverStart => (start) => {
      told.push(`start ${name}${memberTag(start)}`)
      return (end) => void told.push(`end ${name}${memberTag(end)}`)
    },
    press: (name: string): ThreeInput.PressStart => (start) => {
      told.push(`down ${name}${memberTag(start)}`)
      return (end, { success }) => void told.push(`${["cancel", "tap"][Number(success)]} ${name}${memberTag(end)}`)
    },
  }
}

/** A Batch member's tag on a journal line: `#2`, none for a lone object. */
const memberTag = (event: ThreeInput.ScenePointerEvent): string => {
  if (event.member === undefined) return ""
  return `#${event.member}`
}

describe("ThreeInput: hover and press on a scene, hit by a raycast", () => {
  it("IN1: hover starts once a frame finds a mesh under the pointer, with the hit, and ends once it's off; its cancel stops it", () => {
    const { stage, scene } = staged()
    const crate = boxAt(scene, 0, 0, 0, "crate")
    const log = journal()
    let start: ThreeInput.ScenePointerEvent | undefined
    const cancel = stage.hover(crate, (event) => {
      start = event
      return log.hover("crate")(event)
    })
    stage.pointer.over(crate)
    // Nothing yet: the frame casts.
    expect(log.told).toEqual([])
    stage.frame()
    expect(log.told).toEqual(["start crate"])
    expect(start!.object).toBe(crate)
    expect(start!.point!.z).toBeCloseTo(0.5, 5)
    expect(start!.distance).toBeCloseTo(9.5, 5)
    expect([start!.x, start!.y]).toEqual([400, 300])
    stage.pointer.at(10, 10)
    stage.frame()
    expect(log.told).toEqual(["start crate", "end crate"])
    cancel()
    stage.pointer.over(crate)
    stage.frame()
    expect(log.told).toEqual(["start crate", "end crate"])
    stage.dispose()
  })

  it("IN2: hover follows what moves under a still pointer, with no pointer event", async () => {
    const { stage, scene } = staged()
    const crate = boxAt(scene, -3)
    const log = journal()
    stage.hover(crate, log.hover("crate"))
    stage.pointer.at(400, 300)
    stage.frame()
    expect(log.told).toEqual([])
    stage.animate(crate, { x: 0 }, { type: "tween", duration: 0.1, ease: "linear" })
    await Promise.resolve()
    for (let i = 0; i < 10; i++) stage.frame()
    expect(log.told).toEqual(["start crate"])
    stage.dispose()
  })

  it("IN3: the nearest drawn object wins: one in front blocks, one hidden or on a layer the camera doesn't draw doesn't", () => {
    const { stage, scene } = staged()
    const back = boxAt(scene, 0, 0, -2, "back")
    const front = boxAt(scene, 0, 0, 2, "front")
    const log = journal()
    stage.hover(back, log.hover("back"))
    stage.pointer.at(400, 300)
    stage.frame()
    expect(log.told).toEqual([])
    front.visible = false
    stage.frame()
    expect(log.told).toEqual(["start back"])
    front.visible = true
    stage.frame()
    expect(log.told).toEqual(["start back", "end back"])
    front.layers.set(2)
    stage.frame()
    expect(log.told).toEqual(["start back", "end back", "start back"])
    // A hidden parent hides its children.
    const group = new THREE.Group()
    scene.add(group)
    group.add(front)
    front.layers.set(0)
    group.visible = false
    stage.frame()
    expect(log.told).toEqual(["start back", "end back", "start back"])
    stage.dispose()
  })

  it("IN4: a hit on a child is a hit on each object above it", () => {
    const { stage, scene } = staged()
    const group = new THREE.Group()
    scene.add(group)
    const child = boxAt(group, 0)
    const log = journal()
    stage.hover(group, log.hover("group"))
    stage.hover(child, log.hover("child"))
    stage.pointer.over(child)
    stage.frame()
    expect(log.told.sort()).toEqual(["start child", "start group"])
    stage.dispose()
  })

  it("IN5: a press ends with success on the object, and without it off the object, a cancel, or off the canvas", () => {
    const { stage, scene } = staged()
    const crate = boxAt(scene, 0)
    const log = journal()
    stage.press(crate, log.press("crate"))
    stage.pointer.over(crate)
    stage.frame()
    stage.pointer.down()
    stage.pointer.up()
    expect(log.told).toEqual(["down crate", "tap crate"])
    stage.pointer.down()
    stage.pointer.at(10, 10)
    stage.frame()
    stage.pointer.up()
    expect(log.told.slice(2)).toEqual(["down crate", "cancel crate"])
    stage.pointer.over(crate)
    stage.frame()
    stage.pointer.down()
    stage.pointer.cancel()
    expect(log.told.slice(4)).toEqual(["down crate", "cancel crate"])
    // Held, then released off the canvas: the window hears it.
    stage.pointer.down()
    stage.pointer.leave()
    stage.pointer.at(900, 900)
    stage.pointer.up()
    expect(log.told.slice(6)).toEqual(["down crate", "cancel crate"])
    stage.dispose()
  })

  it("IN6: a down and a release are cast where they happen, with no frame between them and the move", () => {
    const { stage, scene } = staged()
    const crate = boxAt(scene, 0)
    const log = journal()
    stage.press(crate, log.press("crate"))
    stage.pointer.at(10, 10)
    stage.frame()
    stage.pointer.over(crate)
    stage.pointer.down()
    stage.pointer.up()
    expect(log.told).toEqual(["down crate", "tap crate"])
    stage.dispose()
  })

  it("IN7: an InstancedMesh's Batch: each instance hovered and pressed by its instanceId, told as the event's member", async () => {
    const { stage, scene } = staged()
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 5)
    for (let i = 0; i < 5; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation((i - 2) * 2, 0, 0))
    scene.add(mesh)
    const swarm = stage.batch(mesh)
    const log = journal()
    stage.hover(swarm, log.hover("swarm"))
    stage.hover(swarm.at(3), log.hover("three"))
    stage.press(swarm, log.press("swarm"))
    stage.pointer.over(swarm.at(1))
    stage.frame()
    expect(log.told).toEqual(["start swarm#1"])
    stage.pointer.over(swarm.at(3))
    stage.frame()
    expect(log.told.slice(1).sort()).toEqual(["end swarm#1", "start swarm#3", "start three"])
    stage.pointer.down()
    stage.pointer.up()
    expect(log.told.slice(4)).toEqual(["down swarm#3", "tap swarm#3"])
    stage.pointer.at(10, 10)
    stage.frame()
    expect(log.told.slice(6).sort()).toEqual(["end swarm#3", "end three"])
    // An instance its Batch moves under a still pointer is hit where it's drawn now.
    const marker = new THREE.Object3D()
    marker.position.set(0, 2, 0)
    scene.add(marker)
    stage.pointer.over(marker)
    stage.frame()
    expect(log.told).toHaveLength(8)
    stage.animate(swarm.at(0), { x: 0, y: 2 }, { type: "tween", duration: 0.1, ease: "linear" })
    await Promise.resolve()
    for (let i = 0; i < 10; i++) stage.frame()
    expect(log.told.at(-1)).toBe("start swarm#0")
    stage.dispose()
  })

  it("IN8: a Batch of meshes: each member by its mesh, and a member's handle alone", () => {
    const { stage, scene } = staged()
    const meshes = [boxAt(scene, -2), boxAt(scene, 0), boxAt(scene, 2)]
    const grid = stage.batch(meshes)
    const log = journal()
    stage.press(grid, log.press("grid"))
    stage.hover(grid.at(2), log.hover("last"))
    stage.pointer.over(meshes[2]!)
    stage.frame()
    stage.pointer.down()
    stage.pointer.up()
    expect(log.told).toEqual(["start last", "down grid#2", "tap grid#2"])
    stage.dispose()
  })

  it("IN9: with no gesture nothing is cast; with one, once a frame per pointer over the canvas; hitTest replaces the raycast", () => {
    let casts = 0
    const { stage, scene } = staged({
      hitTest: (raycaster, root) => {
        casts++
        return raycaster.intersectObject(root, true)
      },
    })
    const crate = boxAt(scene, 0)
    stage.pointer.over(crate)
    stage.frame()
    expect(casts).toBe(0)
    expect(stage.wantsFrame()).toBe(false)
    const log = journal()
    stage.hover(crate, log.hover("crate"))
    expect(stage.wantsFrame()).toBe(true)
    stage.frame()
    stage.frame()
    expect(casts).toBe(2)
    expect(log.told).toEqual(["start crate"])
    // A pointer off the canvas casts nothing.
    stage.pointer.leave()
    stage.frame()
    expect(casts).toBe(2)
    expect(log.told).toEqual(["start crate", "end crate"])
    stage.dispose()
  })

  it("IN10: a runtime with no input, or a canvas with no camera, and a Subject that isn't one, are errors naming the way", () => {
    const wardic = WardicThree.make()
    expect(() => wardic.hover(new THREE.Mesh(), () => {})).toThrow(/no scene input\. Give make the canvas the scene is drawn on, its camera and the scene/)
    expect(() => WardicThree.make({ canvas: new EventTarget() as never })).toThrow(/needs its camera and its scene too/)
    const { stage } = staged()
    expect(() => stage.press({ x: 1 }, () => {})).toThrow(/isn't a scene object, a Batch or a Batch's member/)
    wardic.dispose()
    stage.dispose()
  })

  it("IN11: a callback that throws is reported, and the next gesture still runs; dispose stops listening", () => {
    const { stage, scene } = staged()
    const crate = boxAt(scene, 0)
    const log = journal()
    stage.hover(crate, () => {
      throw new Error("boom")
    })
    stage.hover(crate, log.hover("crate"))
    stage.pointer.over(crate)
    stage.frame()
    expect(log.told).toEqual(["start crate"])
    stage.dispose()
    stage.pointer.at(10, 10)
    stage.frame()
    expect(log.told).toEqual(["start crate"])
  })

  it("TS1: a stage's frame advances its time and makes the scene's matrices current, as a render does", async () => {
    const { stage, scene } = staged()
    const crate = boxAt(scene, 0)
    stage.animate(crate, { x: 2 }, { type: "tween", duration: 0.1, ease: "linear" })
    await Promise.resolve()
    for (let i = 0; i < 8; i++) stage.frame()
    expect(stage.now()).toBeCloseTo((8 * 1000) / 60, 6)
    expect(crate.matrixWorld.elements[12]).toBe(2)
    stage.pointer.over(crate)
    expect(stage.pointer.position().x).toBeGreaterThan(400)
    stage.dispose()
  })
})
