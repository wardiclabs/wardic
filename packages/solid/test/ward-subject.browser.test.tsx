// `ward` with its Subject first, `held`, and the hand-off to a Stage (#884's PR 3; ADR-0073 decisions 8
// and 12, *Amendment (#884)*'s Q4 and Q8), in a real browser.
//
// - WS1: `ward(el, config)` is `ward(config)(el)`: it animates the element it's given, on Complete and
//   Slim wards alike.
// - WS2: an accessor first with no Stage is an error: it's a scene's Subject (decision 10), and on the page
//   a ward given to `ref` follows each element.
// - WS3: `held` joins the component's `<Loading>` while the ward's `animate` is loading: the fallback
//   shows, then the element animates to what landed.
// - WS4: under a `<WardicStage>`, a Subject the Stage says is its own, and any accessor, go to the Stage's
//   ward with the config and options; a config, and an element, stay the DOM's.
// - WS5: with no Stage, an object with an `is…` flag is an error naming `<WardicStage>`.
// - WS6: a whole accessor as the config is still the ward's own error.
// - WS7: `createFrameEffect` under a Stage runs in the Stage's Frame effects, asking it for a frame.
import type { JSX } from "@solidjs/web"
import type * as InputSource from "@wardic/core/InputSource"
import { DomLive } from "@wardic/dom"
import { createFrameEffect, type Stage, type StageWard, w, ward, WardicProvider, WardicStage } from "@wardic/solid"
import { createMemo, createSignal, Loading } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** An element's committed translateX: its computed matrix's e, 0 for none. */
const translateXOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  return Number(/\(([^)]+)\)/.exec(t)![1]!.split(",")[4])
}

const LINEAR = { type: "tween", duration: 0.1, ease: "linear" } as const

// The fake Stage's Subjects, as an Environment adds its own (`@wardic/three/solid`'s three.js objects).
declare module "@wardic/solid" {
  interface StageSubjects {
    readonly thing: { readonly isThing: true }
  }
}

/** A Stage that records what it's handed: its Subjects are objects flagged `isThing`. */
const fakeStage = () => {
  const handed: Array<readonly [unknown, unknown, unknown]> = []
  const effects: Array<(time: number) => void> = []
  let requests = 0
  const stageWard = { held: null } as unknown as StageWard
  const stage: Stage = {
    isSubject: (value) => (value as { readonly isThing?: boolean }).isThing === true,
    ward: (subject, config, options) => {
      handed.push([subject, config, options])
      return stageWard
    },
    animate: () => undefined as never,
    frameEffects: {
      add: (effect) => {
        effects.push(effect)
        return () => void effects.splice(effects.indexOf(effect), 1)
      },
      request: () => void requests++,
    },
    input: {} as InputSource.InputSource["Service"],
  }
  return { stage, handed, effects, stageWard, requests: () => requests }
}

describe("ward with its Subject first, held, and a Stage (#884's PR 3)", () => {
  it("WS1: ward(el, config) animates the element it's given, Complete and Slim alike", async () => {
    let complete!: HTMLElement
    let slim!: HTMLElement
    const Box = () => {
      complete = (<div style={{ width: "20px", height: "20px" }} />) as HTMLElement
      slim = (<div style={{ width: "20px", height: "20px" }} />) as HTMLElement
      ward(complete, { initial: { x: 0 }, animate: { x: 40 }, transition: LINEAR })
      w.ward(slim, { initial: { x: 0 }, animate: { x: 60 }, transition: LINEAR })
      return [complete, slim] as unknown as JSX.Element
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await until(() => translateXOf(complete) === 40 && translateXOf(slim) === 60)
    expect([translateXOf(complete), translateXOf(slim)]).toEqual([40, 60])
  })

  it("WS2: an accessor first with no Stage is an error pointing to the ward given to ref", () => {
    let message = ""
    const Box = () => {
      try {
        ward((() => undefined) as never, { animate: { opacity: 1 } })
      } catch (error) {
        message = (error as Error).message
      }
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(message).toMatch(/an accessor Subject is a Stage's/)
  })

  it("WS3: held joins the component's <Loading> while its animate loads, then the element animates there", async () => {
    let land!: (x: number) => void
    const gate = new Promise<number>((resolve) => (land = resolve))
    const el = document.createElement("div")
    document.body.append(el)
    const Card = () => {
      const target = createMemo(() => gate)
      const card = ward(el, { animate: () => ({ x: target() }), transition: LINEAR })
      return card.held
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p class="fallback">loading</p>}>
          <Card />
        </Loading>
      </WardicProvider>
    ))
    await frames(3)
    expect(host.querySelector(".fallback")).not.toBeNull()
    land(80)
    await until(() => host.querySelector(".fallback") === null, 4000, "the fallback to go")
    await until(() => translateXOf(el) === 80, 4000, "the element at what landed")
    el.remove()
  })

  it("WS4: under a Stage, its Subjects and any accessor go to its ward; a config and an element stay the DOM's", () => {
    const { stage, handed, stageWard } = fakeStage()
    const thing = { isThing: true } as const
    const config = { animate: { y: 1 } }
    const options = { parent: undefined }
    let given: ReadonlyArray<unknown> = []
    const Box = () => {
      const fromSubject = ward(thing, config, options as never)
      const fromAccessor = ward(() => thing, config)
      const domWard = ward({ animate: { opacity: 1 } })
      const onElement = ward(document.createElement("div"), { animate: { opacity: 1 } })
      given = [fromSubject, fromAccessor, domWard, onElement]
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicStage value={stage}>
          <Box />
        </WardicStage>
      </WardicProvider>
    ))
    expect(handed).toHaveLength(2)
    expect(handed[0]).toEqual([thing, config, options])
    expect(given[0]).toBe(stageWard)
    expect(given[1]).toBe(stageWard)
    expect(given[2]).not.toBe(stageWard)
    expect(given[3]).not.toBe(stageWard)
    expect("held" in (given[3] as object)).toBe(true)
  })

  it("WS5 and WS6: with no Stage, a flagged object is an error naming <WardicStage>; a whole accessor config is the ward's own error", () => {
    const errors: Array<string> = []
    const Box = () => {
      try {
        // A type error too: no Environment added it to StageSubjects.
        ward({ isMesh: true, position: {} } as never, { animate: { x: 1 } })
      } catch (error) {
        errors.push((error as Error).message)
      }
      try {
        ward((() => ({ animate: { x: 1 } })) as never)
      } catch (error) {
        errors.push((error as Error).message)
      }
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(errors[0]).toMatch(/no <WardicStage> is above it/)
    expect(errors[1]).toMatch(/accessor/)
  })

  it("WS7: createFrameEffect under a Stage runs in the Stage's Frame effects, asking it for a frame", async () => {
    const fake = fakeStage()
    const [count, setCount] = createSignal(0)
    const applied: Array<number> = []
    const Box = () => {
      createFrameEffect(count, (n) => void applied.push(n))
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicStage value={fake.stage}>
          <Box />
        </WardicStage>
      </WardicProvider>
    ))
    await frames(2)
    expect(fake.effects).toHaveLength(1)
    expect(fake.requests()).toBeGreaterThan(0)
    // The Stage's Host loop runs it: nothing has, so nothing applied yet.
    expect(applied).toEqual([])
    fake.effects[0]!(16)
    expect(applied).toEqual([0])
    setCount(1)
    fake.effects[0]!(32)
    expect(applied).toEqual([0, 1])
  })
})
