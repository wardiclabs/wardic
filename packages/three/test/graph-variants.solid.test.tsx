// Variants down three's graph (#885's PR 3; ADR-0073 decision 17, *Amendment (#885)* Q7), on `TestStage`
// in Node with no DOM.
//
// - GV1: a Scene object with variants and no names of its own follows the ward above it in the graph:
//   it starts at the name that ward's `initial` hands down, and moves with its `animate`.
// - GV2: `staggerChildren` follows the children's places among their parent's `children`, not the order
//   their wards mounted in.
// - GV3: an object moved to another parent follows that parent's ward from then on.
// - GV4: a ward above that starts after its children have mounted: they follow it then.
// - GV5: a ward with names of its own, one with `inherit: false`, and a material follow no one.
// - GV6: `when: "beforeChildren"` holds the children until the ward above settles.
// - GV7: a mesh's own variants fade its material, through the lookup (ADR-0069 decision 5).
import { ward, WardicStage } from "@wardic/solid"
import { createSceneObject, TestStage } from "@wardic/three/solid"
import type { JSX } from "@solidjs/web"
import { children, createRenderEffect, createRoot, createSignal, flush } from "solid-js"
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three"
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
const meshOf = () => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ transparent: true }))

const stageOf = () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
  camera.position.set(0, 0, 8)
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
  return { scene, stage, frames }
}

const PIP = { closed: { scale: 0 }, open: { scale: 1 } } as const

/** `"open"` while `on()`, else `"closed"`. */
const nameOf = (on: () => boolean) => (): "open" | "closed" => {
  if (on()) return "open"
  return "closed"
}

describe("variants down three's graph (#885's PR 3)", () => {
  it("GV1: a Scene object with variants follows the ward above it: from its initial name, with its animate", async () => {
    const { stage, frames } = stageOf()
    const card = meshOf()
    const pips = [meshOf(), meshOf()]
    const [open, setOpen] = createSignal(true)
    const Card = () => {
      createSceneObject(card, { variants: { closed: { y: 0 }, open: { y: 0 } }, initial: "closed", animate: nameOf(open), transition: LINEAR })
      for (const pip of pips) createSceneObject(pip, { parent: card, variants: PIP, transition: LINEAR })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    flush()
    expect(pips[0]!.parent).toBe(card)
    stage.frame()
    expect(pips[0]!.scale.x, "they start at the card's initial name").toBeLessThan(0.1)
    await frames(20)
    expect(pips.map((pip) => pip.scale.x)).toEqual([1, 1])
    setOpen(false)
    await frames(20)
    expect(pips.map((pip) => pip.scale.x)).toEqual([0, 0])
  })

  it("GV2: staggerChildren follows their places among the parent's children, not the order they mounted in", async () => {
    const { scene, stage, frames } = stageOf()
    const card = meshOf()
    scene.add(card)
    const [a, b, c] = [meshOf(), meshOf(), meshOf()]
    // Their places: c, b, a. Their wards mount a, b, c.
    card.add(c, b, a)
    const [open, setOpen] = createSignal(false)
    const Card = () => {
      ward(card, {
        variants: { closed: { y: 0 }, open: { y: 0, transition: { staggerChildren: 0.1 } } },
        animate: nameOf(open),
      })
      for (const pip of [a, b, c]) createSceneObject(pip, { variants: PIP, transition: LINEAR })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    await frames(20)
    expect([a, b, c].map((pip) => pip.scale.x)).toEqual([0, 0, 0])
    setOpen(true)
    await frames(9)
    // 0.15 s in: c started at 0, b at 0.1 s, a at 0.2 s.
    expect(c.scale.x).toBeGreaterThan(b.scale.x)
    expect(b.scale.x).toBeGreaterThan(a.scale.x)
    expect(a.scale.x).toBeCloseTo(0, 5)
    await frames(30)
    expect([a, b, c].map((pip) => pip.scale.x)).toEqual([1, 1, 1])
  })

  it("GV3: an object moved to another parent follows that parent's ward from then on", async () => {
    const { scene, stage, frames } = stageOf()
    const left = meshOf()
    const right = meshOf()
    scene.add(left, right)
    const pip = meshOf()
    left.add(pip)
    const Cards = () => {
      ward(left, { variants: { closed: {}, open: {} }, animate: "open" })
      ward(right, { variants: { closed: {}, open: {} }, animate: "closed" })
      createSceneObject(pip, { variants: PIP, transition: LINEAR })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Cards />
      </WardicStage>
    ))
    await frames(20)
    expect(pip.scale.x).toBeCloseTo(1, 5)
    right.add(pip)
    await frames(20)
    expect(pip.scale.x, "it follows the right card's closed").toBeCloseTo(0, 5)
    left.add(pip)
    await frames(20)
    expect(pip.scale.x).toBeCloseTo(1, 5)
  })

  it("GV4: a ward above that starts after its children have mounted: they follow it then", async () => {
    const { scene, stage, frames } = stageOf()
    const card = meshOf()
    scene.add(card)
    const pip = meshOf()
    card.add(pip)
    const [shown, setShown] = createSignal(false)
    const Card = () => {
      const on = () => {
        if (shown()) return card
        return undefined
      }
      ward(on, { variants: { closed: {}, open: {} }, animate: "open" })
      ward(pip, { variants: { closed: { x: 0 }, open: { x: 2 } }, transition: LINEAR })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    await frames(20)
    expect(pip.position.x, "no ward above it yet").toBe(0)
    setShown(true)
    await frames(20)
    expect(pip.position.x).toBeCloseTo(2, 5)
  })

  it("GV5: a ward with names of its own, one with inherit: false, and a material follow no one", async () => {
    const { scene, stage, frames } = stageOf()
    const card = meshOf()
    scene.add(card)
    const own = meshOf()
    const apart = meshOf()
    card.add(own, apart)
    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.5 })
    const Cards = () => {
      ward(card, { variants: { closed: {}, open: {} }, animate: "open" })
      ward(own, { variants: { closed: { x: 0 }, open: { x: 2 }, mine: { x: -1 } }, animate: "mine", transition: LINEAR })
      ward(apart, { variants: { closed: { x: 0 }, open: { x: 2 } }, inherit: false, transition: LINEAR } as never)
      ward(material, { variants: { closed: { opacity: 0 }, open: { opacity: 1 } }, transition: LINEAR })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Cards />
      </WardicStage>
    ))
    await frames(20)
    expect(own.position.x).toBeCloseTo(-1, 5)
    expect(apart.position.x).toBe(0)
    expect(material.opacity).toBe(0.5)
  })

  it("GV6: when: beforeChildren holds the children until the ward above settles", async () => {
    const { stage, frames } = stageOf()
    const card = meshOf()
    const pip = meshOf()
    const [open, setOpen] = createSignal(false)
    const Card = () => {
      createSceneObject(card, {
        variants: { closed: { y: 0 }, open: { y: 1, transition: { ...LINEAR, when: "beforeChildren" } } },
        animate: nameOf(open),
        transition: LINEAR,
      })
      createSceneObject(pip, { parent: card, variants: PIP, transition: LINEAR })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    await frames(20)
    setOpen(true)
    await frames(6)
    expect(card.position.y, "the card moves first").toBeGreaterThan(0.2)
    expect(pip.scale.x, "the pip waits").toBe(0)
    await frames(30)
    expect(card.position.y).toBeCloseTo(1, 5)
    expect(pip.scale.x).toBeCloseTo(1, 5)
  })

  it("GV7: a mesh's own variants fade its material, through the lookup", async () => {
    const { stage, frames } = stageOf()
    const card = meshOf()
    const group = new Group()
    const [open, setOpen] = createSignal(false)
    const Card = () => {
      createSceneObject(card, { parent: group, variants: { closed: { opacity: 0 }, open: { opacity: 1 } }, animate: nameOf(open), transition: LINEAR })
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Card />
      </WardicStage>
    ))
    await frames(20)
    expect(card.material.opacity).toBeCloseTo(0, 5)
    setOpen(true)
    await frames(20)
    expect(card.material.opacity).toBeCloseTo(1, 5)
  })
})
