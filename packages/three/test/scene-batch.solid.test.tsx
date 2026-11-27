// `createBatch` in a scene (#885's PR 5; ADR-0073 decision 16, ADR-0070 decisions 11–13, *Amendment (#885)*
// Q9), on `TestStage` in Node with no DOM.
//
// - BT1: keyed meshes: each item's object made as it enters, joined to the Stage's scene, from `initial` to `animate`.
// - BT2: a new order turns every member toward its index now, `stagger()` counting them.
// - BT3: an item gone plays `exit`, then its object leaves; `dispose: true` disposes it. With no `exit`, at once.
// - BT4: `parent`: the members join it.
// - BT5: an `InstancedMesh`'s instances, keyed: each at the next free index; one leaving plays its exit, then
//   the last moves into its index, its values with it, and `count` drops.
// - BT6: more members than the mesh holds is an error naming its capacity.
// - BT7: by count: `count` objects, each `animate(i)`.
// - BT8: a member's hover, through the scene's raycast: its `whileHover`, and `hoverStart` with `{ i, item, element }`.
// - BT9: `next("settled")` tells how many set off; with no Stage that makes Batches, an error naming one.
// - BT10: Batches are a Stage's feature: a Stage without `stageBatches` makes none, an error naming it.
// - BT11 (#981): a member's `removed` listener throwing as it leaves: with no exit, the others leaving with it
//   still go; with an exit, it goes and is disposed; reported once each time.
// - BT12 (#979, row 34; ADR-0074): a member's `whileHover` that throws: reported, its hoverStart and
//   hoverEnd told, and a change of `animate` while it's hovered moves every member, Solid going on; read
//   once as its hover starts (ADR-0070 Q58), it scales at its next hover once it stops throwing.
// - BT13 (#979, row 34): a `whileHover` giving a key the Batch hasn't: reported at the hover, and the
//   next change of `animate` moves every member.
// - BT14 (ADR-0070 Q59): a hovered member keeps its hover's values through a change of `animate` that
//   leaves it under the pointer, as it read them at the hover's start.
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import { createBatch, type StageBatch, stagger, WardicStage } from "@wardic/solid"
import { stageBatches, TestStage } from "@wardic/three/solid"
import type { JSX } from "@solidjs/web"
import { children, createRenderEffect, createRoot, createSignal, Errored, flush } from "solid-js"
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from "three"
import { afterEach, describe, expect, it } from "vitest"
import { reportsDuring, saidDuring } from "../../object/test/reports.ts"

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

const stageOf = () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
  camera.position.set(0, 0, 10)
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
  return { scene, stage, frames }
}

interface Item {
  readonly id: string
}

const meshOf = () => new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial())

/** `make`'s Batch, made in a component under the stage. */
const batchOn = (stage: TestStage.TestStage, make: () => StageBatch): (() => StageBatch) => {
  let made!: StageBatch
  const Grid = () => {
    made = make()
    return null
  }
  mountTree(() => (
    <WardicStage value={stage}>
      <Grid />
    </WardicStage>
  ))
  return () => made
}

/** An instance's position in `mesh`. */
const instanceAt = (mesh: InstancedMesh, index: number): Vector3 => {
  const matrix = new Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new Vector3().setFromMatrixPosition(matrix)
}

describe("createBatch in a scene (#885's PR 5)", () => {
  it("BT1: keyed meshes, each made as it enters, joined to the scene, from initial to animate", async () => {
    const { scene, stage, frames } = stageOf()
    const made = new Map<string, Mesh>()
    const [items] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        object: (item: Item) => {
          const mesh = meshOf()
          made.set(item.id, mesh)
          return mesh
        },
        initial: { scale: 0 },
        animate: (_item: Item, i: number) => ({ x: i, scale: 1 }),
        transition: LINEAR,
      }),
    )
    flush()
    expect(made.size).toBe(3)
    expect(made.get("b")!.parent).toBe(scene)
    stage.frame()
    expect(made.get("a")!.scale.x, "its first frame at its initial").toBeLessThan(0.1)
    await frames(20)
    expect(["a", "b", "c"].map((id) => made.get(id)!.position.x)).toEqual([0, 1, 2])
    expect(made.get("c")!.scale.x).toBeCloseTo(1, 5)
  })

  it("BT2: a new order turns every member toward its index now, stagger() counting them", async () => {
    const { stage, frames } = stageOf()
    const made = new Map<string, Mesh>()
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        object: (item: Item) => {
          const mesh = meshOf()
          made.set(item.id, mesh)
          return mesh
        },
        animate: (_item: Item, i: number) => ({ x: i * 2 }),
        transition: { ...LINEAR, delay: stagger(0.1) },
      }),
    )
    await frames(40)
    setItems([{ id: "c" }, { id: "a" }, { id: "b" }])
    await frames(40)
    expect(["c", "a", "b"].map((id) => made.get(id)!.position.x)).toEqual([0, 2, 4])
  })

  it("BT3: an item gone plays exit, then its object leaves and is disposed; with no exit, at once", async () => {
    const { scene, stage, frames } = stageOf()
    const made = new Map<string, Mesh>()
    const disposed: Array<string> = []
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }])
    batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        object: (item: Item) => {
          const mesh = meshOf()
          mesh.geometry.addEventListener("dispose", () => void disposed.push(item.id))
          made.set(item.id, mesh)
          return mesh
        },
        animate: (_item: Item, i: number) => ({ x: i, scale: 1 }),
        exit: { scale: 0 },
        dispose: true,
        transition: LINEAR,
      }),
    )
    await frames(20)
    setItems([{ id: "a" }])
    await frames(4)
    expect(made.get("b")!.parent, "in the scene while its exit plays").toBe(scene)
    expect(made.get("b")!.scale.x).toBeLessThan(1)
    expect(made.get("b")!.scale.x).toBeGreaterThan(0)
    await frames(20)
    expect(made.get("b")!.parent).toBeNull()
    expect(disposed).toEqual(["b"])

    // With no exit: at once.
    const plain = stageOf()
    const kept = new Map<string, Mesh>()
    const [list, setList] = createSignal<ReadonlyArray<Item>>([{ id: "x" }])
    batchOn(plain.stage, () => createBatch({ each: list, key: "id", object: (item: Item) => kept.set(item.id, meshOf()).get(item.id)!, animate: () => ({ x: 1 }) }))
    await plain.frames(2)
    setList([])
    flush()
    expect(kept.get("x")!.parent).toBeNull()
  })

  it("BT4: parent: the members join it", () => {
    const { scene, stage } = stageOf()
    const board = new Group()
    scene.add(board)
    const made: Array<Mesh> = []
    const [items] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }])
    batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        parent: board,
        object: () => {
          const mesh = meshOf()
          made.push(mesh)
          return mesh
        },
        animate: (_item: Item, i: number) => ({ x: i }),
      }),
    )
    flush()
    expect(made.map((mesh) => mesh.parent === board)).toEqual([true, true])
  })

  it("BT5: an InstancedMesh's instances, keyed: one leaving plays its exit, then the last moves into its index", async () => {
    const { scene, stage, frames } = stageOf()
    const swarm = new InstancedMesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial(), 4)
    scene.add(swarm)
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        instances: swarm,
        animate: (item: Item) => ({ x: { a: 1, b: 2, c: 3, d: 4 }[item.id as "a" | "b" | "c" | "d"], scale: 1 }),
        exit: { scale: 0 },
        transition: LINEAR,
      }),
    )
    await frames(20)
    expect(swarm.count).toBe(3)
    expect([0, 1, 2].map((index) => instanceAt(swarm, index).x)).toEqual([1, 2, 3])
    setItems([{ id: "a" }, { id: "c" }])
    await frames(4)
    expect(swarm.count, "b still drawn while its exit plays").toBe(3)
    await frames(20)
    expect(swarm.count).toBe(2)
    // c, last, moved into b's index, with its values.
    expect([0, 1].map((index) => instanceAt(swarm, index).x)).toEqual([1, 3])
    setItems([{ id: "a" }, { id: "c" }, { id: "d" }])
    await frames(20)
    expect(swarm.count, "d at the next free index").toBe(3)
  })

  it("BT6: more members than the InstancedMesh holds is an error naming its capacity", () => {
    const { stage } = stageOf()
    const swarm = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 2)
    const [items] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    // Thrown in its effect, as it enters its members: its owner's boundary catches it.
    let thrown: unknown
    const Grid = () => {
      createBatch({ each: items, key: "id", instances: swarm, animate: () => ({ x: 1 }) })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Errored
          fallback={(error) => {
            thrown = (error as unknown as () => unknown)()
            return null
          }}
        >
          <Grid />
        </Errored>
      </WardicStage>
    ))
    flush()
    expect(String(thrown)).toMatch(/holds 2 instances/)
  })

  it("BT7: by count: count objects, each animate(i)", async () => {
    const { stage, frames } = stageOf()
    const made: Array<Mesh> = []
    batchOn(stage, () =>
      createBatch({
        count: 3,
        object: (i: number) => {
          const mesh = meshOf()
          made[i] = mesh
          return mesh
        },
        animate: (i: number) => ({ y: i }),
        transition: LINEAR,
      }),
    )
    await frames(20)
    expect(made.map((mesh) => mesh.position.y)).toEqual([0, 1, 2])
  })

  it("BT8: a member's hover through the scene's raycast: its whileHover, and hoverStart with { i, item, element }", async () => {
    const { stage, frames } = stageOf()
    const made = new Map<string, Mesh>()
    const [items] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }])
    const grid = batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        object: (item: Item) => {
          const mesh = meshOf()
          made.set(item.id, mesh)
          return mesh
        },
        animate: (_item: Item, i: number) => ({ x: i * 3 - 1.5 }),
        whileHover: { scale: 1.5 },
        transition: LINEAR,
      }),
    )
    await frames(20)
    const heard = grid().next("hoverStart")
    stage.pointer.over(made.get("b")!)
    // A frame's raycast finds the hover; the change it makes runs from the next task, as a browser's next frame.
    await frames(1)
    await frames(20)
    expect(made.get("b")!.scale.x).toBeCloseTo(1.5, 5)
    expect(made.get("a")!.scale.x).toBe(1)
    const info = await heard
    expect(info.i).toBe(1)
    expect(info.item).toEqual({ id: "b" })
    expect(info.element).toBe(made.get("b"))
    stage.pointer.leave()
    await frames(1)
    await frames(20)
    expect(made.get("b")!.scale.x, "back to where it started: animate sets no scale").toBeCloseTo(1, 5)
  })

  it("BT9: next('settled') tells how many set off; with no Stage that makes Batches, an error naming one", async () => {
    const { stage, frames } = stageOf()
    const [items] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    const grid = batchOn(stage, () => createBatch({ each: items, key: "id", object: () => meshOf(), initial: { x: -1 }, animate: () => ({ x: 1 }), transition: LINEAR }))
    const landed = grid().next("settled")
    await frames(30)
    expect((await landed).moved).toBe(3)

    let thrown: unknown
    createRoot(() => {
      try {
        createBatch({ each: items, key: "id", object: () => meshOf(), animate: () => ({ x: 1 }) })
      } catch (error) {
        thrown = error
      }
    })
    expect(String(thrown)).toMatch(/no Stage above it makes a scene's Batches/)
  })

  it("BT10: a Stage without stageBatches makes no Batches: an error naming it", () => {
    const bare = TestStage.make({ scene: new Scene(), camera: new PerspectiveCamera(), size: { width: 800, height: 600 } })
    const [items] = createSignal<ReadonlyArray<Item>>([{ id: "a" }])
    let thrown: unknown
    const Grid = () => {
      try {
        createBatch({ each: items, key: "id", object: () => meshOf(), animate: () => ({ x: 1 }) })
      } catch (error) {
        thrown = error
      }
      return null
    }
    mountTree(() => (
      <WardicStage value={bare}>
        <Grid />
      </WardicStage>
    ))
    expect(String(thrown)).toMatch(/features: \[stageBatches\]/)
  })

  it("BT11: a member's removed listener throwing as it leaves: the others still go, it's disposed, reported once (#981)", async () => {
    const throwing = (mesh: Mesh): Mesh => {
      mesh.addEventListener("removed", () => {
        throw new Error("a cache's listener broke")
      })
      return mesh
    }

    // With no exit: the three go at once, in one change.
    const plain = stageOf()
    const made = new Map<string, Mesh>()
    const [list, setList] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }, { id: "c" }])
    batchOn(plain.stage, () =>
      createBatch({
        each: list,
        key: "id",
        object: (item: Item) => {
          const mesh = meshOf()
          if (item.id === "a") throwing(mesh)
          made.set(item.id, mesh)
          return mesh
        },
        animate: () => ({ x: 1 }),
      }),
    )
    await plain.frames(2)
    const plainReports = await reportsDuring(async () => {
      setList([])
      flush()
    })
    expect(Arr.map(["a", "b", "c"], (id) => made.get(id)!.parent), "every one left").toEqual([null, null, null])
    expect(plainReports).toEqual(["wardic.stage: a Subject's leave failed"])

    // With an exit: it goes as its exit lands, and is disposed.
    const { scene, stage, frames } = stageOf()
    const exiting = new Map<string, Mesh>()
    const disposed: Array<string> = []
    const [items, setItems] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }])
    batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        object: (item: Item) => {
          const mesh = meshOf()
          if (item.id === "a") throwing(mesh)
          mesh.geometry.addEventListener("dispose", () => void disposed.push(item.id))
          exiting.set(item.id, mesh)
          return mesh
        },
        animate: (_item: Item, i: number) => ({ x: i, scale: 1 }),
        exit: { scale: 0 },
        dispose: true,
        transition: LINEAR,
      }),
    )
    await frames(20)
    const reports = await reportsDuring(async () => {
      setItems([])
      await frames(4)
      expect(exiting.get("a")!.parent, "in the scene while its exit plays").toBe(scene)
      await frames(20)
    })
    expect(Arr.map(["a", "b"], (id) => exiting.get(id)!.parent), "both left").toEqual([null, null])
    expect(disposed.sort(), "both disposed").toEqual(["a", "b"])
    expect(reports).toEqual(["wardic.stage: a Subject's leave failed"])
  })

  /** Two keyed meshes on `animate`'s x, shifted by `shift()`, with `whileHover` and the keys given. */
  const hoveredOn = (whileHover: unknown, keys?: ReadonlyArray<string>) => {
    const { stage, frames } = stageOf()
    const made = new Map<string, Mesh>()
    const [items] = createSignal<ReadonlyArray<Item>>([{ id: "a" }, { id: "b" }])
    const [shift, setShift] = createSignal(0)
    const grid = batchOn(stage, () =>
      createBatch({
        each: items,
        key: "id",
        ...UndefinedOr.match(keys, { onUndefined: () => ({}), onDefined: (given) => ({ keys: given }) }),
        object: (item: Item) => {
          const mesh = meshOf()
          made.set(item.id, mesh)
          return mesh
        },
        animate: (_item: Item, i: number) => ({ x: i * 3 - 1.5 + shift() }),
        whileHover: whileHover as never,
        transition: LINEAR,
      }),
    )
    return { stage, frames, made, grid, setShift }
  }

  it("BT12 (#979, row 34): a whileHover that throws: reported, its events told, a change moves every member, and it scales once it stops", async () => {
    let broken = true
    const { stage, frames, made, grid, setShift } = hoveredOn(
      (item: Item) => {
        if (Bool.and(item.id === "b", broken)) throw new Error("b's whileHover broke")
        return { scale: 1.5 }
      },
      ["x", "scale"],
    )
    await frames(20)
    const told: Array<string> = []
    void grid().next("hoverStart").then(() => told.push("hoverStart"), () => undefined)
    const said = await saidDuring(async () => {
      stage.pointer.over(made.get("b")!)
      await frames(1)
      await frames(20)
    })
    expect(said.filter((line) => line.includes("createBatch: a gesture failed")), "reported").toHaveLength(1)
    expect(made.get("b")!.scale.x, "no hover layer").toBe(1)
    // A change of animate while b is hovered, small enough to leave it under the pointer: its whileHover
    // isn't called again, so nothing halts.
    setShift(0.1)
    await frames(1)
    await frames(20)
    expect([made.get("a")!.position.x, made.get("b")!.position.x], "every member moved").toEqual([-1.4, 1.6])
    void grid().next("hoverEnd").then(() => told.push("hoverEnd"), () => undefined)
    stage.pointer.leave()
    await frames(1)
    await frames(20)
    expect(told, "its hover's start and end, both told").toEqual(["hoverStart", "hoverEnd"])
    broken = false
    stage.pointer.over(made.get("b")!)
    await frames(1)
    await frames(20)
    expect(made.get("b")!.scale.x, "read again at its next hover").toBeCloseTo(1.5, 5)
  })

  it("BT13 (#979, row 34): a whileHover giving a key the Batch hasn't: reported at the hover, and the next change moves every member", async () => {
    // A function's keys aren't the Batch's unless `keys` names them: here only x.
    const { stage, frames, made, setShift } = hoveredOn(() => ({ scale: 1.5 }))
    await frames(20)
    const said = await saidDuring(async () => {
      stage.pointer.over(made.get("b")!)
      await frames(1)
      await frames(20)
    })
    expect(said.filter((line) => line.includes("createBatch: a gesture failed")), "reported at the hover").toHaveLength(1)
    expect(said.join("\n"), "naming the key").toContain(`"scale" isn't one of its keys`)
    setShift(0.1)
    await frames(1)
    await frames(20)
    expect([made.get("a")!.position.x, made.get("b")!.position.x], "every member moved").toEqual([-1.4, 1.6])
  })

  it("BT14 (ADR-0070 Q59): a hovered member keeps its hover's values through a change of animate that leaves it under the pointer", async () => {
    const { stage, frames, made, setShift } = hoveredOn({ scale: 1.5 })
    await frames(20)
    stage.pointer.over(made.get("b")!)
    await frames(1)
    await frames(20)
    expect(made.get("b")!.scale.x).toBeCloseTo(1.5, 5)
    // A shift of 0.1 keeps it under the pointer (a shift of 1 moves it out, and its hover ends).
    setShift(0.1)
    await frames(1)
    await frames(20)
    expect(made.get("b")!.position.x, "moved").toBeCloseTo(1.6, 5)
    expect(made.get("b")!.scale.x, "still hovered").toBeCloseTo(1.5, 5)
  })
})
