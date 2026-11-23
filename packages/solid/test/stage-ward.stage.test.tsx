// A ward on a Stage's Subject (#884's PR 4; ADR-0073 decisions 8, 10 and 20, *Amendment (#884)*'s Q2, Q5
// and Q10): `ward(box, config)` under a `<WardicStage>` over `@wardic/object`, in Node with no DOM, on
// frames the test pumps as a Host loop would. Its hovers and presses come from a pushed InputSource.
//
// - SW1: `initial` is written before its first frame, `animate` lands, and `settled()` and `read` see it.
// - SW2: an async `animate`, with `held`: its component's `<Loading>` shows its fallback, then the box
//   animates to what landed.
// - SW3: `whileHover` and `whileTap` through the Stage's input; `next("tap")` and `tapped()` hear the tap.
// - SW4: an accessor Subject: a new one takes the ward over from its `initial`, and the last keeps its values.
// - SW5: its own `variants`, named by `animate`.
// - SW6: a key of the page's (`whileFocus`) is an error naming it, and `drag` on a Stage with no `drag` (#885) is one; so are
//   Animation controls as its `animate`.
// - SW7: the Stage's `animate` on its Subject goes through the ward's spine, and the ward's next change takes it back.
// - SW8: `createHover(box)` and `createPress(box)` read the box through the Stage's input; with no Stage
//   above, a Subject is an error naming `<WardicStage>`.
import * as InputSource from "@wardic/core/InputSource"
import * as WardicObject from "@wardic/object/WardicObject"
import { createHover, createPress, type Stage, createAnimationControls, stageWard, type StageWard, ward, WardicStage } from "@wardic/solid"
import { TestInput } from "@wardic/test"
import type { JSX } from "@solidjs/web"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { children, createMemo, createRenderEffect, createRoot, createSignal, flush, Loading } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"

interface Box {
  readonly isBox: true
  x: number
  scale: number
}

// The test Stage's Subjects, as an Environment adds its own.
declare module "@wardic/solid" {
  interface StageSubjects {
    readonly box: Box
  }
}

const box = (x = 0): Box => ({ isBox: true, x, scale: 1 })

const LINEAR = { type: "tween", duration: 0.1, ease: "linear" } as const

/** A task: what the runtime's scheduler starts a run in. */
const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const FRAME = 1000 / 60

/** A Stage over `@wardic/object`, on frames the test pumps, its input pushed. */
const makeStage = () => {
  const wardic = WardicObject.make()
  const pushed = Effect.runSync(TestInput.pushable())
  const input = Effect.runSync(Effect.scoped(Layer.build(pushed.layer))).pipe(Context.get(InputSource.InputSource))
  const environment = wardic.stageEnvironment
  const stage: Stage = {
    isSubject: (value) => (value as { readonly isBox?: boolean }).isBox === true,
    ward: stageWard({ ...environment, input }),
    animate: wardic.animate as Stage["animate"],
    frameEffects: environment.frameEffects,
    input,
  }
  const clock = { time: 0 }
  /**
   * `n` frames of the Host loop, Solid's updates applied before each. A Retarget's run starts on the
   * runtime's scheduler, a task after the flush that started it, so the frames wait for one first.
   */
  const frames = async (n: number): Promise<void> => {
    flush()
    await later()
    for (let i = 0; i < n; i++) {
      flush()
      clock.time += FRAME
      wardic.frame(clock.time)
    }
    flush()
  }
  const push = (type: InputSource.PointerLikeEvent["type"]): void => {
    Effect.runSync(pushed.push(InputSource.makePointerLikeEvent({ type, timeStamp: clock.time })))
    flush()
  }
  return { wardic, stage, frames, push }
}

/** What a renderer does with the tree: read it inside a root, tracked (*Amendment (#881)*, item 3). */
const disposers: Array<() => void> = []
const mountTree = (tree: () => JSX.Element): void =>
  createRoot((dispose) => {
    const resolved = children(tree)
    createRenderEffect(
      () => resolved(),
      () => undefined,
    )
    disposers.push(dispose)
  })
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

/** A microtask, for what Solid applies at one. */
const tick = (): Promise<void> => Promise.resolve()

describe("a ward on a Stage's Subject (#884's PR 4)", () => {
  it("SW1: initial is written before its first frame, animate lands, and settled() and read see it", async () => {
    const { stage, frames } = makeStage()
    const crate = box(50)
    let made!: StageWard
    const Crate = () => {
      made = ward(crate, { initial: { x: 0 }, animate: { x: 100 }, transition: LINEAR })
      return made.held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    await tick()
    await frames(1)
    // Written before any frame moved it: its first drawn frame shows `initial`, or a step past it.
    expect(crate.x).toBeLessThan(20)
    await frames(20)
    expect(crate.x).toBe(100)
    await tick()
    flush()
    expect(made.read("x")()).toBe(100)
    expect(made.settled()?.target).toEqual({ x: 100 })
  })

  it("SW2: an async animate, with held: the <Loading> fallback shows, then the box animates to what landed", async () => {
    const { stage, frames } = makeStage()
    const crate = box(0)
    let land!: (x: number) => void
    const gate = new Promise<number>((resolve) => (land = resolve))
    const log: Array<string> = []
    const Fallback = () => {
      log.push("fallback")
      return null
    }
    const Crate = () => {
      const to = createMemo(() => gate)
      return ward(crate, { initial: { x: 0 }, animate: () => ({ x: to() }), transition: LINEAR }).held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Loading fallback={<Fallback />}>
          <Crate />
        </Loading>
      </WardicStage>
    ))
    await frames(3)
    expect(log).toEqual(["fallback"])
    expect(crate.x).toBe(0)
    land(80)
    await gate
    await tick()
    await frames(20)
    expect(crate.x).toBe(80)
  })

  it("SW3: whileHover and whileTap through the Stage's input; next('tap') and tapped() hear the tap", async () => {
    const { stage, frames, push } = makeStage()
    const crate = box()
    let made!: StageWard
    const Crate = () => {
      made = ward(crate, { whileHover: { scale: 1.5 }, whileTap: { scale: 0.5 }, transition: LINEAR })
      return made.held
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    await frames(1)
    push("enter")
    await frames(12)
    expect(crate.scale).toBe(1.5)
    const tapped = made.next("tap")
    push("down")
    await frames(12)
    expect(crate.scale).toBe(0.5)
    push("up")
    await expect(tapped).resolves.toMatchObject({ element: crate })
    await frames(12)
    expect(crate.scale).toBe(1.5)
    expect(made.tapped()?.element).toBe(crate)
    push("leave")
    await frames(12)
    expect(crate.scale).toBe(1)
  })

  it("SW4: an accessor Subject: a new one takes the ward over from its initial, and the last keeps its values", async () => {
    const { stage, frames } = makeStage()
    const a = box(5)
    const b = box(5)
    const [which, setWhich] = createSignal<Box>(a)
    const Crate = () => ward(which, { initial: { x: 0 }, animate: { x: 30 }, transition: LINEAR }).held
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    await tick()
    await frames(20)
    expect([a.x, b.x]).toEqual([30, 5])
    setWhich(b)
    await frames(1)
    expect(b.x).toBeLessThan(10)
    await frames(20)
    expect([a.x, b.x]).toEqual([30, 30])
  })

  it("SW5: its own variants, named by animate", async () => {
    const { stage, frames } = makeStage()
    const crate = box()
    const [open, setOpen] = createSignal(false)
    const Crate = () =>
      ward(crate, {
        variants: { open: { x: 40 }, closed: { x: 0 } },
        initial: "closed",
        animate: () => {
          if (open()) return "open"
          return "closed"
        },
        transition: LINEAR,
      }).held
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    await tick()
    await frames(5)
    expect(crate.x).toBe(0)
    setOpen(true)
    await frames(20)
    expect(crate.x).toBe(40)
  })

  it("SW6: a key of the page's is an error naming it, and so is drag on a Stage that drags nothing", () => {
    const { stage } = makeStage()
    const errors: Array<string> = []
    const Crate = () => {
      try {
        ward(box(), { whileFocus: { scale: 2 } })
      } catch (error) {
        errors.push((error as Error).message)
      }
      try {
        ward(box(), { drag: "x" })
      } catch (error) {
        errors.push((error as Error).message)
      }
      try {
        ward(box(), { animate: createAnimationControls() })
      } catch (error) {
        errors.push((error as Error).message)
      }
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    expect(errors[0]).toMatch(/`whileFocus` is the page's/)
    expect(errors[1]).toMatch(/the Stage above it drags nothing/)
    expect(errors[2]).toMatch(/doesn't follow Animation controls/)
  })

  it("SW7: the Stage's animate goes through the ward's spine, and its next change takes the key back", async () => {
    const { stage, frames } = makeStage()
    const crate = box()
    const [to, setTo] = createSignal(20)
    const Crate = () => ward(crate, { animate: () => ({ x: to() }), transition: LINEAR }).held
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    await tick()
    await frames(20)
    expect(crate.x).toBe(20)
    void stage.animate(crate, { x: 70 }, LINEAR)
    await tick()
    await frames(20)
    expect(crate.x).toBe(70)
    setTo(10)
    await frames(20)
    expect(crate.x).toBe(10)
  })

  it("SW8: createHover(box) and createPress(box) read the box through the Stage's input; with no Stage, an error", () => {
    const { stage, push } = makeStage()
    const crate = box()
    let hovered!: () => boolean
    let pressed!: () => boolean
    const Crate = () => {
      hovered = createHover(crate)
      pressed = createPress(crate)
      return null
    }
    mountTree(() => (
      <WardicStage value={stage}>
        <Crate />
      </WardicStage>
    ))
    expect([hovered(), pressed()]).toEqual([false, false])
    push("enter")
    expect(hovered()).toBe(true)
    push("down")
    expect(pressed()).toBe(true)
    push("up")
    push("leave")
    expect([hovered(), pressed()]).toEqual([false, false])
    let message = ""
    const Loose = () => {
      try {
        createHover(box())
      } catch (error) {
        message = (error as Error).message
      }
      return null
    }
    mountTree(() => <Loose />)
    expect(message).toMatch(/no <WardicStage> above it/)
  })
})
