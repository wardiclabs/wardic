// `createSceneObject` (#885's PR 2; ADR-0073 decisions 10, 14 and 15, *Amendment (#881)* item 2,
// *Amendment (#885)* Q5 and Q6), on `TestStage` in Node with no DOM.
//
// - SO1: it joins the Stage's scene once its ward can start, its `initial` drawn in its first frame.
// - SO2: an `animate` still loading: it waits out of the scene, `held` holding its `<Loading>`, then joins.
// - SO3: its parent: the one given, else the one it has (it stays there), else the Stage's scene.
// - SO4: its owner ends: its `exit` plays from where it is, then it leaves; `exitStart`, `exitComplete`.
// - SO5: with no `exit`, it leaves as its owner ends.
// - SO6: an accessor's `undefined` plays its exit and takes it out; its next object enters afresh.
// - SO7: an accessor's next object enters as the last one exits, both in the scene at once.
// - SO8: `dispose: true` disposes its geometries and materials, and its descendants', once it has left.
// - SO9: the Stage's end lands an exit still in flight.
// - SO10: its `exit` a variant name; an exit's own transition.
// - SO11: `ward(mesh, { exit })` is an error naming `createSceneObject`; no three.js Stage above it is one too.
// - SO12: an object given again while it's still exiting stays: its exit stops, and it returns from where it is.
// - SO13 (#979): the first of two Scene objects leaving whose exit variant throws leaves without it, reported;
//   the other exits, and both leave the scene.
// - SO14 (#981): with no exit, its `removed` listener throwing as its owner ends: it has left, `exitComplete`
//   told, reported, and the rest of its owner's end goes on.
// - SO15 (#981): so, as its exit lands by itself. SO16: so, as the Stage's end lands it.
// - SO17 (#981): `dispose: true`, its `removed` listener and a geometry's `dispose` listener throwing: every
//   part is disposed, the first throw reported.
import { ward, WardicStage } from "@wardic/solid"
import { createSceneObject, type SceneObject, TestStage } from "@wardic/three/solid"
import type { JSX } from "@solidjs/web"
import { children, createMemo, createRenderEffect, createRoot, createSignal, flush, Loading } from "solid-js"
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three"
import { afterEach, describe, expect, it } from "vitest"
import { reportsDuring, reportsIn, saidDuring } from "../../object/test/reports.ts"

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

const LINEAR = { type: "tween", duration: 0.2, ease: "linear" } as const

/** Where `promise` is, read later: pending until it settles. */
const stateOf = (promise: Promise<unknown>): (() => "pending" | "resolved" | "rejected") => {
  let state: "pending" | "resolved" | "rejected" = "pending"
  promise.then(
    () => void (state = "resolved"),
    () => void (state = "rejected"),
  )
  return () => state
}

const meshOf = () => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())

/** `mesh` with an app's `removed` listener that throws (#981). */
const breaksOnRemoved = (mesh: Mesh): void =>
  mesh.addEventListener("removed", () => {
    throw new Error("a cache's listener broke")
  })

const stageOf = () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
  camera.position.set(0, 0, 8)
  const stage = TestStage.make({ scene, camera, size: { width: 800, height: 600 } })
  /** `n` frames, Solid's updates applied before each, a task waited first for a run to start. */
  const frames = async (n: number): Promise<void> => {
    flush()
    await later()
    for (let i = 0; i < n; i++) {
      flush()
      stage.frame()
    }
    flush()
  }
  return { scene, stage, frames }
}

describe("createSceneObject (#885's PR 2)", () => {
  it("SO1: joins the Stage's scene once its ward can start, its initial drawn in its first frame", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    const Card = () => createSceneObject(mesh, { initial: { scale: 0 }, animate: { scale: 1 }, transition: LINEAR }).held
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    flush()
    expect(mesh.parent).toBe(scene)
    stage.frame()
    expect(mesh.scale.x, "its first frame shows its initial").toBeCloseTo(0, 5)
    await frames(20)
    expect(mesh.scale.x).toBeCloseTo(1, 5)
  })

  it("SO2: an animate still loading: it waits out of the scene, held holds its <Loading>, then it joins", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    let land!: (x: number) => void
    const loaded = new Promise<number>((resolve) => (land = resolve))
    const log: Array<string> = []
    const Fallback = () => {
      log.push("fallback")
      return null
    }
    const Card = () => {
      const to = createMemo(() => loaded)
      return createSceneObject(mesh, { initial: { x: 0, scale: 0 }, animate: () => ({ x: to(), scale: 1 }), transition: LINEAR }).held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Loading fallback={<Fallback />}>
          <Card />
        </Loading>
      </WardicStage>
    ))
    await frames(3)
    expect(log).toEqual(["fallback"])
    expect(mesh.parent, "not in the scene while its data loads").toBeNull()
    land(2)
    await loaded
    await Promise.resolve()
    flush()
    expect(mesh.parent).toBe(scene)
    // Its run started as it joined, so its first frame draws one step from its initial: never its own scale, 1.
    stage.frame()
    expect(mesh.scale.x, "its first frame enters from its initial").toBeLessThan(0.1)
    await frames(20)
    expect(mesh.position.x).toBeCloseTo(2, 5)
  })

  it("SO3: its parent is the one given, else the one it has, else the Stage's scene", () => {
    const { scene, stage } = stageOf()
    const group = new Group()
    scene.add(group)
    const given = meshOf()
    const model = new Group()
    const node = meshOf()
    model.add(node)
    scene.add(model)
    const loose = meshOf()
    const Cards = () => {
      createSceneObject(given, { parent: group, animate: { x: 1 } })
      createSceneObject(node, { animate: { x: 1 } })
      createSceneObject(loose, { animate: { x: 1 } })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Cards />
      </WardicStage>
    ))
    flush()
    expect(given.parent).toBe(group)
    expect(node.parent, "a node of a model stays where it is").toBe(model)
    expect(loose.parent).toBe(scene)
  })

  it("SO4: its owner ends: its exit plays from where it is, then it leaves; exitStart and exitComplete", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    let card!: SceneObject
    const Card = () => {
      card = createSceneObject(mesh, { initial: { x: 0 }, animate: { x: 2 }, exit: { x: 0 }, transition: LINEAR })
      return card.held
    }
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(6)
    const midway = mesh.position.x
    expect(midway, "partway to 2").toBeGreaterThan(0.5)
    expect(midway).toBeLessThan(1.8)
    const heard: Array<string> = []
    const started = card.next("exitStart").then((info) => void heard.push(`start ${info.element === mesh}`))
    const completed = card.next("exitComplete").then((info) => void heard.push(`complete ${info.element === mesh} ${mesh.parent === null}`))
    setShown(false)
    flush()
    await started
    expect(mesh.parent, "still in the scene as its exit plays").toBe(scene)
    stage.frame()
    expect(mesh.position.x, "its exit starts from where it was, not from 2").toBeLessThan(midway + 0.2)
    await frames(20)
    await completed
    expect(mesh.position.x).toBeCloseTo(0, 5)
    expect(mesh.parent).toBeNull()
    expect(heard).toEqual(["start true", "complete true true"])
  })

  it("SO5: with no exit, it leaves as its owner ends", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    const Card = () => createSceneObject(mesh, { animate: { x: 1 }, transition: LINEAR }).held
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(2)
    expect(mesh.parent).toBe(scene)
    setShown(false)
    flush()
    expect(mesh.parent).toBeNull()
  })

  it("SO6: an accessor's undefined plays its exit and takes it out; its next object enters afresh", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    const [open, setOpen] = createSignal(true)
    let card!: SceneObject
    const Card = () => {
      const shown = () => {
        if (open()) return mesh
        return undefined
      }
      card = createSceneObject(shown, { initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 0 }, transition: LINEAR })
      return card.held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    await frames(20)
    expect(mesh.scale.x).toBeCloseTo(1, 5)
    const completed = card.next("exitComplete")
    setOpen(false)
    await frames(3)
    expect(mesh.parent, "in the scene while it exits").toBe(scene)
    expect(mesh.scale.x).toBeLessThan(1)
    await frames(20)
    await completed
    expect(mesh.parent).toBeNull()
    setOpen(true)
    flush()
    expect(mesh.parent).toBe(scene)
    stage.frame()
    expect(mesh.scale.x, "it enters from its initial again").toBeCloseTo(0, 5)
    await frames(20)
    expect(mesh.scale.x).toBeCloseTo(1, 5)
  })

  it("SO7: an accessor's next object enters as the last one exits, both in the scene at once", async () => {
    const { scene, stage, frames } = stageOf()
    const a = meshOf()
    const b = meshOf()
    const [tab, setTab] = createSignal<"a" | "b">("a")
    let card!: SceneObject
    const Card = () => {
      const current = () => {
        if (tab() === "a") return a
        return b
      }
      card = createSceneObject(current, { initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 0 }, transition: LINEAR })
      return card.held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    await frames(20)
    expect(a.scale.x).toBeCloseTo(1, 5)
    const completed = card.next("exitComplete")
    setTab("b")
    await frames(6)
    expect(a.parent, "the last exits").toBe(scene)
    expect(b.parent, "as the next enters").toBe(scene)
    expect(a.scale.x).toBeLessThan(0.9)
    expect(b.scale.x).toBeGreaterThan(0.1)
    await frames(20)
    expect((await completed).element).toBe(a)
    expect(a.parent).toBeNull()
    expect(a.scale.x).toBeCloseTo(0, 5)
    expect(b.scale.x).toBeCloseTo(1, 5)
    expect(card.read("scale")(), "read follows the object it's on now").toBeCloseTo(1, 5)
  })

  it("SO8: dispose: true disposes its geometries and materials, and its descendants', once it has left", async () => {
    const { stage, frames } = stageOf()
    const mesh = meshOf()
    const child = meshOf()
    mesh.add(child)
    const kept = meshOf()
    const disposed: Array<string> = []
    const watch = (name: string, target: { addEventListener: (type: "dispose", listener: () => void) => void }) => target.addEventListener("dispose", () => void disposed.push(name))
    watch("geometry", mesh.geometry)
    watch("material", mesh.material)
    watch("child geometry", child.geometry)
    watch("child material", child.material)
    watch("kept geometry", kept.geometry)
    const Cards = () => {
      createSceneObject(mesh, { animate: { x: 1 }, exit: { x: 0 }, dispose: true, transition: LINEAR })
      createSceneObject(kept, { animate: { x: 1 }, transition: LINEAR })
      return null
    }
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Cards />}</WardicStage>)
    await frames(20)
    setShown(false)
    flush()
    expect(disposed, "nothing while it exits").toEqual([])
    await frames(20)
    expect(disposed.sort()).toEqual(["child geometry", "child material", "geometry", "material"])
  })

  it("SO9: the Stage's end lands an exit still in flight", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    const Card = () => createSceneObject(mesh, { animate: { x: 1 }, exit: { x: 0 }, transition: { type: "tween", duration: 5, ease: "linear" } }).held
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(2)
    setShown(false)
    await frames(2)
    expect(mesh.parent, "exiting").toBe(scene)
    stage.dispose()
    expect(mesh.parent).toBeNull()
  })

  it("SO10: its exit a variant name, on the exit's own transition", async () => {
    const { stage, frames } = stageOf()
    const mesh = meshOf()
    const Card = () =>
      createSceneObject(mesh, {
        variants: { shown: { y: 1 }, gone: { y: -1, transition: { type: "tween", duration: 0.1, ease: "linear" } } },
        initial: { y: 0 },
        animate: "shown",
        exit: "gone",
        transition: { type: "tween", duration: 1, ease: "linear" },
      }).held
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(70)
    expect(mesh.position.y).toBeCloseTo(1, 5)
    setShown(false)
    // 0.1 s, its own transition's, not the ward's second.
    await frames(8)
    expect(mesh.position.y).toBeCloseTo(-1, 5)
    expect(mesh.parent).toBeNull()
  })

  it("SO12: an object given again while it's still exiting stays: its exit stops, and it returns from where it is", async () => {
    const { scene, stage, frames } = stageOf()
    const a = meshOf()
    const b = meshOf()
    const [tab, setTab] = createSignal<"a" | "b" | "none">("a")
    let card!: SceneObject
    const Card = () => {
      const current = () => {
        if (tab() === "a") return a
        if (tab() === "b") return b
        return undefined
      }
      card = createSceneObject(current, { initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 0 }, transition: LINEAR })
      return card.held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    await frames(20)
    // A swap, and back, inside the exit: a stays in the scene and returns to its scale from where it was.
    setTab("b")
    await frames(4)
    const exiting = a.scale.x
    expect(exiting).toBeLessThan(1)
    expect(exiting).toBeGreaterThan(0)
    setTab("a")
    await frames(1)
    expect(a.scale.x, "from where it was, not its initial").toBeGreaterThan(exiting - 0.15)
    await frames(30)
    expect(a.parent, "its old exit doesn't take it out").toBe(scene)
    expect(a.scale.x).toBeCloseTo(1, 5)
    expect(b.parent, "b exited and left").toBeNull()
    expect(card.read("scale")()).toBeCloseTo(1, 5)
    // Gone, and back, inside the exit: the same.
    setTab("none")
    await frames(4)
    setTab("a")
    await frames(30)
    expect(a.parent).toBe(scene)
    expect(a.scale.x).toBeCloseTo(1, 5)
    // And it still leaves when it's let go for good.
    setTab("none")
    await frames(30)
    expect(a.parent).toBeNull()
  })

  it("SO11: ward(mesh, { exit }) is an error naming createSceneObject, and so is no three.js Stage above it", () => {
    const { stage } = stageOf()
    const mesh = meshOf()
    let wardError: unknown
    let stageError: unknown
    createRoot(() => {
      try {
        stage.ward(mesh, { animate: { x: 1 }, exit: { x: 0 } })
      } catch (error) {
        wardError = error
      }
      try {
        createSceneObject(mesh, { animate: { x: 1 } })
      } catch (error) {
        stageError = error
      }
    })
    expect(String(wardError)).toMatch(/createSceneObject/)
    expect(String(stageError)).toMatch(/no three\.js Stage above it/)
    void ward
  })

  it("SO13: the first of two leaving whose exit variant throws leaves without it, reported; the other exits, and both leave (#979)", async () => {
    const { scene, stage, frames } = stageOf()
    const first = meshOf()
    const second = meshOf()
    let broken = false
    const variants = {
      gone: () => {
        if (broken) throw new Error("its variant broke")
        return { x: 0 }
      },
    }
    const slow = { type: "tween", duration: 0.5, ease: "linear" } as const
    const First = () => createSceneObject(first, { animate: { x: 1 }, variants: variants as never, exit: "gone", transition: slow }).held
    const Second = () => createSceneObject(second, { animate: { x: 1 }, exit: { x: 0 }, transition: slow }).held
    const [shown, setShown] = createSignal(true)
    mountTree(() => (
      <WardicStage value={stage}>
        {shown() && <First />}
        {shown() && <Second />}
      </WardicStage>
    ))
    const reports = await reportsDuring(async () => {
      await frames(2)
      broken = true
      // Before #979, its throw came out of this flush, and the first stayed in the scene for good.
      setShown(false)
      await frames(2)
      expect(first.parent, "the first left at once").toBeNull()
      expect(second.parent, "the second exiting").toBe(scene)
      await frames(40)
      expect(second.parent, "the second left once its exit landed").toBeNull()
    })
    expect(reports).toEqual(["wardic.presence: an exit variant failed"])
  })

  it("SO14: with no exit, its removed listener throwing as its owner ends: it has left, told, reported, its owner ends (#981)", async () => {
    const { stage, frames } = stageOf()
    const mesh = meshOf()
    breaksOnRemoved(mesh)
    let card!: SceneObject
    const Card = () => {
      card = createSceneObject(mesh, { animate: { x: 1 }, transition: LINEAR })
      return card.held
    }
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(2)
    const completed = stateOf(card.next("exitComplete"))
    const reports = await reportsDuring(async () => {
      setShown(false)
      flush()
    })
    expect(mesh.parent).toBeNull()
    expect(completed(), "exitComplete told").toBe("resolved")
    const asked = stateOf(card.next("exitStart"))
    await later()
    expect(asked(), "its owner's end went on: its exit waits end").toBe("rejected")
    expect(reports).toEqual(["wardic.stage: a Subject's leave failed"])
  })

  it("SO15: its exit landing by itself, its removed listener throwing: it has left, told, reported once (#981)", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    breaksOnRemoved(mesh)
    let card!: SceneObject
    const Card = () => {
      card = createSceneObject(mesh, { animate: { x: 1 }, exit: { x: 0 }, transition: LINEAR })
      return card.held
    }
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(20)
    const completed = stateOf(card.next("exitComplete"))
    const reports = await reportsDuring(async () => {
      setShown(false)
      await frames(2)
      expect(mesh.parent, "exiting").toBe(scene)
      // Before #981, its landing's throw was the gate's afterFlush failure, and exitComplete never came.
      await frames(20)
    })
    expect(mesh.parent).toBeNull()
    expect(completed(), "exitComplete told").toBe("resolved")
    const asked = stateOf(card.next("exitStart"))
    await later()
    expect(asked(), "its last exit landed: its exit waits end").toBe("rejected")
    expect(reports).toEqual(["wardic.stage: a Subject's leave failed"])
  })

  it("SO16: the Stage's end landing its exit, its removed listener throwing: it has left, told, reported once (#981)", async () => {
    const { scene, stage, frames } = stageOf()
    const mesh = meshOf()
    breaksOnRemoved(mesh)
    let card!: SceneObject
    const Card = () => {
      card = createSceneObject(mesh, { animate: { x: 1 }, exit: { x: 0 }, transition: { type: "tween", duration: 5, ease: "linear" } })
      return card.held
    }
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(2)
    setShown(false)
    await frames(2)
    expect(mesh.parent, "exiting").toBe(scene)
    const completed = stateOf(card.next("exitComplete"))
    const reports = await reportsDuring(() => stage.dispose())
    expect(mesh.parent).toBeNull()
    expect(completed(), "exitComplete told").toBe("resolved")
    expect(reports).toEqual(["wardic.stage: a Subject's leave failed"])
  })

  it("SO17: dispose: true, its removed listener and one geometry's dispose listener throwing: every part disposed, reported once (#981)", async () => {
    const { stage, frames } = stageOf()
    const mesh = meshOf()
    const child = meshOf()
    mesh.add(child)
    const disposed: Array<string> = []
    const watch = (name: string, target: { addEventListener: (type: "dispose", listener: () => void) => void }) => target.addEventListener("dispose", () => void disposed.push(name))
    watch("geometry", mesh.geometry)
    watch("material", mesh.material)
    watch("child geometry", child.geometry)
    watch("child material", child.material)
    breaksOnRemoved(mesh)
    mesh.geometry.addEventListener("dispose", () => {
      throw new Error("a pool's listener broke")
    })
    const Card = () => createSceneObject(mesh, { animate: { x: 1 }, dispose: true, transition: LINEAR }).held
    const [shown, setShown] = createSignal(true)
    mountTree(() => <WardicStage value={stage}>{shown() && <Card />}</WardicStage>)
    await frames(2)
    const said = await saidDuring(async () => {
      setShown(false)
      flush()
    })
    expect(mesh.parent).toBeNull()
    expect(disposed.sort(), "the throws skip no part").toEqual(["child geometry", "child material", "geometry", "material"])
    expect(reportsIn(said), "once").toEqual(["wardic.stage: a Subject's leave failed"])
    expect(said.join("\n"), "the first throw's").toContain("a cache's listener broke")
    expect(said.join("\n")).not.toContain("a pool's listener broke")
  })
})
