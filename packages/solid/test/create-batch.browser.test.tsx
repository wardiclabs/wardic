// `createBatch` on Solid 1 (#665, ADR-0070 decisions 10–15 and *Amendment (#665)*): many elements on the
// same keys as one Batch, each held to a Wardic element with the same props on the same Frame loop.
//
// - CB1: a batched element draws what a `wardic.div` with the same `initial`, `animate` and `transition`
//   draws, frame by frame, to its landing and through a change of `animate`.
// - CB2: a change's delay staggers the members it moves, by rank, each as a `wardic.div` delayed so; a
//   member whose target is unchanged isn't written.
// - CB3: with no transition, each key takes its Default transition by the member's own target: a scale
//   toward 0 lands as a `wardic.div`'s toward 0 does, beside one toward 2.
// - CB4: under reduced motion `x` lands at once and `opacity` animates, as a `wardic.div`'s do; under
//   `skipAnimations` every key lands at once.
// - CB5: with no `initial` a member sets off from each key's identity, as a `wardic.div` with none
//   does; with `initial: false` it starts at its target.
// - CB6: `onAnimationStart` comes once as members set off, `onAnimationComplete` once they all rest, with
//   how many set off; an unmount stops its run.
// - CB7: a key the DOM's Batch can't draw, a key a later target gives, a target that isn't a number,
//   an inertia and a repeat are errors naming them.
// - CB8: a member's handle keeps its element's own `style`, less the properties the Batch draws, and calls
//   its `ref`; a `style` given as a string is an error, since Solid would write over the Batch's drawing.
// - CB9: a member whose element is made again mid-flight carries on, frame for frame, beside one whose isn't.
// - CB10: with no transition of its own, a Batch runs the nearest `WardicConfig`'s, as a `wardic.div` does.
// - CB11: per-value entries as a `wardic.div`'s: an entry with only a `delay` holds that key's Default
//   transition by it; a top-level `delay` holds the keys on the top level's fields, not one with its own entry.
// - CB12: an element inside an `<svg>` turns about its own centre: `transform-box: fill-box`.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import { createBatch, stagger, wardic, WardicConfig, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const SPRING = { type: "spring", stiffness: 210, damping: 20 } as const

const matrixOf = (el: Element): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: Element): number => matrixOf(el).m41

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const scaleOf = (el: Element): number => matrixOf(el).a

/** `frames` frames of `read` on each of `elements`, read after each frame: one array per element. */
const readsOver = async (frames: number, elements: ReadonlyArray<Element>, read: (el: Element) => number): Promise<ReadonlyArray<ReadonlyArray<number>>> => {
  const out = elements.map((): Array<number> => [])
  for (let f = 0; f < frames; f++) {
    await raf()
    elements.forEach((el, n) => out[n].push(read(el)))
  }
  return out
}

/** Each frame of `batched` within 1e-6 of `ward`'s. */
const expectSame = (batched: ReadonlyArray<number>, ward: ReadonlyArray<number>): void => {
  expect(batched.length).toBe(ward.length)
  batched.forEach((value, f) => expect(value, `frame ${f}`).toBeCloseTo(ward[f], 6))
}

/** Mount `Scene`, a component, under a provider on `DomLive`; its unmount. */
const mount = (Scene: () => JSX.Element, reducedMotion: "always" | "never" = "never"): (() => void) =>
  render(() => (
    <WardicProvider env={DomLive} reducedMotion={reducedMotion}>
      <Scene />
    </WardicProvider>
  )).unmount

/** `frames` frames of both elements' `x`, read after each. */
const xsOver = async (frames: number, a: Element, b: Element): Promise<ReadonlyArray<readonly [number, number]>> => {
  const out: Array<readonly [number, number]> = []
  for (let f = 0; f < frames; f++) {
    await raf()
    out.push([xOf(a), xOf(b)])
  }
  return out
}

describe("createBatch on Solid 1 (#665)", () => {
  it("CB1: a batched element draws what a wardic.div with the same props draws, frame by frame", async () => {
    const [target, setTarget] = createSignal(100)
    let ward!: HTMLDivElement
    let member!: HTMLDivElement
    const Scene = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: () => ({ x: 0 }), animate: () => ({ x: target() }), transition: SPRING })
      return (
        <>
          <wardic.div ref={ward} style={BOX} initial={{ x: 0 }} animate={{ x: target() }} transition={SPRING} />
          <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
        </>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    const there = await xsOver(60, ward, member)
    expect(there.some(([x]) => x > 1 && x < 99)).toBe(true)
    there.forEach(([x, y]) => expect(y).toBeCloseTo(x, 6))
    expect(there.at(-1)).toEqual([100, 100])
    setTarget(30)
    const back = await xsOver(60, ward, member)
    back.forEach(([x, y]) => expect(y).toBeCloseTo(x, 6))
    expect(back.at(-1)).toEqual([30, 30])
  })

  it("CB2: a change staggers the members it moves by rank, each as a wardic.div delayed so; one unchanged isn't written", async () => {
    const [targets, setTargets] = createSignal([0, 0, 0, 0, 0])
    const delay = stagger(0.05)
    const members: Array<HTMLDivElement> = []
    const wards: Array<HTMLDivElement> = []
    // Members 2, 3 and 4 move: ranks 0, 1 and 2 of 3, which their wards wait by.
    const ranks = [0, 0, 0, 1, 2]
    mount(() => {
      const grid = createBatch({ count: 5, initial: false, animate: (i) => ({ x: targets()[i] }), transition: { ...SPRING, delay } })
      return (
        <For each={[0, 1, 2, 3, 4]}>
          {(i) => (
            <>
              <div style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />
              <wardic.div ref={(el: HTMLDivElement) => (wards[i] = el)} style={BOX} initial={false} animate={{ x: targets()[i] }} transition={{ ...SPRING, delay: delay(ranks[i], 3) }} />
            </>
          )}
        </For>
      )
    })
    await raf()
    await raf()
    const before = members[0].style.transform
    setTargets([0, 0, 120, 120, 120])
    const frames = await readsOver(45, [...members.slice(2), ...wards.slice(2)], xOf)
    Array.from({ length: 3 }).forEach((_, n) => expectSame(frames[n], frames[n + 3]))
    // The last waits 0.1 s, the first not at all.
    expect(frames[2][3]).toBe(0)
    expect(frames[0][3]).toBeGreaterThan(0)
    expect(members[0].style.transform).toBe(before)
  })

  it("CB3: with no transition each key takes its Default transition by its own target: a scale toward 0 beside one toward 2", async () => {
    const members: Array<HTMLDivElement> = []
    const wards: Array<HTMLDivElement> = []
    const targets = [0, 2]
    mount(() => {
      const grid = createBatch({ count: 2, initial: { scale: 1 }, animate: (i) => ({ scale: targets[i] }) })
      return (
        <For each={[0, 1]}>
          {(i) => (
            <>
              <div style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />
              <wardic.div ref={(el: HTMLDivElement) => (wards[i] = el)} style={BOX} initial={{ scale: 1 }} animate={{ scale: targets[i] }} />
            </>
          )}
        </For>
      )
    })
    const frames = await readsOver(40, [...members, ...wards], scaleOf)
    expectSame(frames[0], frames[2])
    expectSame(frames[1], frames[3])
    expect(frames[0].at(-1)).toBe(0)
    expect(frames[1].at(-1)).toBe(2)
  })

  it("CB4: under reduced motion x lands at once and opacity animates, as a wardic.div's; under skipAnimations every key lands at once", async () => {
    let member!: HTMLDivElement
    let ward!: HTMLDivElement
    const Pair = (): JSX.Element => {
      const grid = createBatch({ count: 1, initial: { x: 0, opacity: 0 }, animate: () => ({ x: 100, opacity: 1 }), transition: SPRING })
      return (
        <>
          <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
          <wardic.div ref={ward} style={BOX} initial={{ x: 0, opacity: 0 }} animate={{ x: 100, opacity: 1 }} transition={SPRING} />
        </>
      )
    }
    const unmount = mount(() => <Pair />, "always")
    const xs: Array<readonly [number, number]> = []
    const opacities: Array<readonly [number, number]> = []
    for (let f = 0; f < 30; f++) {
      await raf()
      xs.push([xOf(member), xOf(ward)])
      opacities.push([opacityOf(member), opacityOf(ward)])
    }
    xs.forEach(([batched, own]) => expect(batched).toBeCloseTo(own, 6))
    opacities.forEach(([batched, own]) => expect(batched).toBeCloseTo(own, 6))
    // `x` from 0 to 100 in one frame, never between; `opacity` through the values between.
    expect(xs.every(([x]) => x === 0 || x === 100)).toBe(true)
    expect(xs.at(-1)).toEqual([100, 100])
    expect(opacities.some(([opacity]) => opacity > 0.05 && opacity < 0.95)).toBe(true)
    unmount()
    mount(() => (
      <WardicConfig skipAnimations>
        <Pair />
      </WardicConfig>
    ))
    await raf()
    await raf()
    expect([xOf(member), opacityOf(member)]).toEqual([100, 1])
  })

  it("CB5: with no initial a member sets off from each key's identity, as a wardic.div with none; initial false starts at its target", async () => {
    let member!: HTMLDivElement
    let ward!: HTMLDivElement
    let still!: HTMLDivElement
    mount(() => {
      const grid = createBatch({ count: 1, animate: () => ({ x: 80 }), transition: SPRING })
      const held = createBatch({ count: 1, initial: false, animate: () => ({ x: 80 }), transition: SPRING })
      return (
        <>
          <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
          <wardic.div ref={ward} style={BOX} animate={{ x: 80 }} transition={SPRING} />
          <div style={BOX} {...held.at(0, { ref: (el) => (still = el as HTMLDivElement) })} />
        </>
      )
    })
    const frames = await readsOver(40, [member, ward, still], xOf)
    expectSame(frames[0], frames[1])
    expect(frames[0][1]).toBeLessThan(80)
    expect(frames[2].every((x) => x === 80)).toBe(true)
  })

  it("CB6: onAnimationStart once as members set off, onAnimationComplete once they all rest, with how many; unmount stops its run", async () => {
    const calls: Array<string> = []
    const [target, setTarget] = createSignal(100)
    const members: Array<HTMLDivElement> = []
    const unmount = mount(() => {
      const grid = createBatch({
        count: 3, initial: { x: 0 }, animate: (i) => ({ x: target() + i }), transition: SPRING,
        onAnimationStart: () => calls.push("start"),
        onAnimationComplete: (landing) => calls.push(`complete ${landing.moved}`),
      })
      return <For each={[0, 1, 2]}>{(i) => <div style={BOX} {...grid.at(i, { ref: (el) => (members[i] = el as HTMLDivElement) })} />}</For>
    })
    await readsOver(70, members, xOf)
    expect(calls).toEqual(["start", "complete 3"])
    setTarget(0)
    await raf()
    await raf()
    unmount()
    const at = members[0].style.transform
    await readsOver(5, members, xOf)
    expect(members[0].style.transform).toBe(at)
    expect(calls).toEqual(["start", "complete 3", "start"])
  })

  it("CB7: a key the DOM's Batch can't draw, a key a later target gives, and an inertia are errors naming them", async () => {
    const Wide = (): JSX.Element => {
      createBatch({ count: 1, animate: () => ({ width: 10 }) as never })
      return null
    }
    expect(() => mount(() => <Wide />)).toThrow(/"width"/)
    const Spun = (): JSX.Element => {
      createBatch({ count: 1, animate: () => ({ x: 10 }), transition: { type: "inertia" } as never })
      return null
    }
    expect(() => mount(() => <Spun />)).toThrow(/inertia/)
    const Stops = (): JSX.Element => {
      const grid = createBatch({ count: 1, animate: () => ({ x: [0, 10, 20] }) as never })
      return <div {...grid.at(0)} />
    }
    expect(() => mount(() => <Stops />)).toThrow(/"x"/)
    const Repeats = (): JSX.Element => {
      createBatch({ count: 1, animate: () => ({ x: 10 }), transition: { duration: 0.2, repeat: 2 } })
      return null
    }
    expect(() => mount(() => <Repeats />)).toThrow(/repeat/)
    const [more, setMore] = createSignal(false)
    mount(() => {
      const grid = createBatch({ count: 1, animate: () => Bool.match(more(), { onTrue: () => ({ x: 1, y: 2 }), onFalse: () => ({ x: 1 }) }) as never })
      return <div {...grid.at(0)} />
    })
    expect(() => setMore(true)).toThrow(/"y"/)
  })

  it("CB8: a handle keeps its element's own style, less what the Batch draws, and calls its ref; a string style is an error", async () => {
    let moved!: HTMLDivElement
    let faded!: HTMLDivElement
    let refs = 0
    mount(() => {
      const xs = createBatch({ count: 1, initial: false, animate: () => ({ x: 30 }) })
      const both = createBatch({ count: 1, initial: false, animate: () => ({ x: 30, opacity: 0.8 }) })
      const own = { ...BOX, opacity: 0.5 }
      return (
        <>
          <div {...xs.at(0, { style: own, ref: (el) => ((moved = el as HTMLDivElement), refs++) })} />
          <div {...both.at(0, { style: own, ref: (el) => ((faded = el as HTMLDivElement), refs++) })} />
        </>
      )
    })
    await raf()
    await raf()
    expect(refs).toBe(2)
    expect([moved.style.background, moved.style.opacity, xOf(moved)]).toEqual(["teal", "0.5", 30])
    expect([faded.style.background, faded.style.opacity, xOf(faded)]).toEqual(["teal", "0.8", 30])
    const Text = (): JSX.Element => {
      const grid = createBatch({ count: 1, animate: () => ({ x: 1 }) })
      return <div {...grid.at(0, { style: "width: 10px" as never })} />
    }
    expect(() => mount(() => <Text />)).toThrow(/style/)
  })

  it("CB9: a member whose element is made again mid-flight carries on, frame for frame, beside one whose isn't", async () => {
    const [target, setTarget] = createSignal(0)
    const [shown, setShown] = createSignal(true)
    const members: Array<HTMLDivElement> = []
    mount(() => {
      const grid = createBatch({ count: 2, initial: false, animate: () => ({ x: target() }), transition: { ...SPRING, delay: 0.05 } })
      return (
        <>
          <Show when={shown()}>
            <div style={BOX} {...grid.at(0, { ref: (el) => (members[0] = el as HTMLDivElement) })} />
          </Show>
          <div style={BOX} {...grid.at(1, { ref: (el) => (members[1] = el as HTMLDivElement) })} />
        </>
      )
    })
    await raf()
    setTarget(150)
    await readsOver(8, members, xOf)
    setShown(false)
    await raf()
    setShown(true)
    const after = await readsOver(40, members, xOf)
    expectSame(after[0], after[1])
    expect(after[0][0]).toBeGreaterThan(10)
    expect(after[0].at(-1)).toBe(150)
  })

  it("CB10: with no transition of its own, a Batch runs the nearest WardicConfig's, as a wardic.div does", async () => {
    let member!: HTMLDivElement
    let ward!: HTMLDivElement
    mount(() => {
      const Inner = (): JSX.Element => {
        const grid = createBatch({ count: 1, initial: { x: 0 }, animate: () => ({ x: 90 }) })
        return (
          <>
            <div style={BOX} {...grid.at(0, { ref: (el) => (member = el as HTMLDivElement) })} />
            <wardic.div ref={ward} style={BOX} initial={{ x: 0 }} animate={{ x: 90 }} />
          </>
        )
      }
      return (
        <WardicConfig transition={{ duration: 0.4, ease: "linear" }}>
          <Inner />
        </WardicConfig>
      )
    })
    const frames = await readsOver(30, [member, ward], xOf)
    expectSame(frames[0], frames[1])
    expect(frames[0].some((x) => x > 1 && x < 89)).toBe(true)
  })

  it("CB11: per-value entries as a wardic.div's: an entry with only a delay, and a top-level delay beside a key's own entry", async () => {
    const elements: Array<HTMLDivElement> = []
    const transitions = [
      { x: { delay: 0.15 } },
      { ...SPRING, delay: 0.1, opacity: { duration: 0.2 } },
    ] as const
    mount(() => (
      <For each={[0, 1]}>
        {(n) => {
          const grid = createBatch({ count: 1, initial: { x: 0, opacity: 0 }, animate: () => ({ x: 70, opacity: 1 }), transition: transitions[n] })
          return (
            <>
              <div style={BOX} {...grid.at(0, { ref: (el) => (elements[n * 2] = el as HTMLDivElement) })} />
              <wardic.div ref={(el: HTMLDivElement) => (elements[n * 2 + 1] = el)} style={BOX} initial={{ x: 0, opacity: 0 }} animate={{ x: 70, opacity: 1 }} transition={transitions[n]} />
            </>
          )
        }}
      </For>
    ))
    const xs: Array<Array<number>> = elements.map(() => [])
    const opacities: Array<Array<number>> = elements.map(() => [])
    for (let f = 0; f < 40; f++) {
      await raf()
      elements.forEach((el, e) => {
        xs[e].push(xOf(el))
        opacities[e].push(opacityOf(el))
      })
    }
    expectSame(xs[0], xs[1])
    expectSame(opacities[0], opacities[1])
    expectSame(xs[2], xs[3])
    expectSame(opacities[2], opacities[3])
    // The entry's delay holds `x` 0.15 s; opacity, on its own entry, isn't held by the top level's.
    expect(xs[0].slice(0, 7).every((x) => x === 0)).toBe(true)
    expect(opacities[2][2]).toBeGreaterThan(0)
  })

  it("CB12: an element inside an <svg> turns about its own centre", async () => {
    let rect!: SVGRectElement
    mount(() => {
      const grid = createBatch({ count: 1, initial: false, animate: () => ({ rotate: 45 }) })
      return (
        <svg width="100" height="100">
          <rect width="20" height="20" {...grid.at(0, { ref: (el) => (rect = el as SVGRectElement) })} />
        </svg>
      )
    })
    await raf()
    expect([rect.style.transformBox, rect.style.transformOrigin]).toEqual(["fill-box", "50% 50%"])
  })
})
