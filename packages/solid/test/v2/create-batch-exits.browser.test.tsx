// A keyed Batch's exits under `<AnimatePresence>` on Solid 2 (#665, PR 3b, Q46–Q48): Solid 1's
// (`../create-batch-exits.browser.test.tsx`), each member held to a `w.div` with the same exit under its
// own presence, frame for frame, and the presence handle heard.
//
// - CVE1: two items leave in one change: each member's exit, staggered by its rank among the leavers,
//   draws what its `w.div` draws, frame for frame, each element going as its own exit lands; the
//   presence handle's `exiting()` holds through them, and `next("exitComplete")` resolves once both are gone.
// - CVE2: a key back mid-exit: its old element goes at once, and its new one takes the member over, as a
//   keyed `w.div` takes over (#286).
// - CVE3: `initial={false}` starts the first render's members at their targets; `mode="wait"` holds an
//   entering member, unmoved, until the leaver's exit lands; `popLayout` pops the leaver out of the flow;
//   `exit` as a function hears the presence's `custom`.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import type { JSX } from "@solidjs/web"
import { AnimatePresence, createBatch, createPresence, type Presence, type PresenceMode, stagger, w, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, For, untrack } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const TWEEN = { type: "tween", duration: 0.3 } as const

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/**
 * A keyed Batch of `start`'s items under one `<AnimatePresence>`, its handle `presence`, and a `w.div` for
 * each under another, each entering from `opacity: 0` to `x: i * 40, opacity: 1`, leaving to
 * `opacity: 0` on a 0.2 s tween, a member staggered by its rank among the leavers, a ward by `rankOf(id)`.
 */
/** How `mountBoth` mounts its presences: their mode and `initial`. */
interface Mounting {
  readonly mode?: PresenceMode
  readonly initial?: boolean
}

const mountBoth = (start: ReadonlyArray<string>, rankOf: (id: string) => number, mounting: Mounting = {}) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const members = new Map<string, HTMLDivElement>()
  const wards = new Map<string, HTMLDivElement>()
  let presence!: Presence
  const Scene = (): JSX.Element => {
    presence = createPresence()
    const list = createBatch({
      each: items,
      key: (id) => id,
      initial: { opacity: 0 },
      animate: (_, i) => ({ x: i * 40, opacity: 1 }),
      exit: { opacity: 0, transition: { type: "tween", duration: 0.2, delay: stagger(0.1) } },
      transition: TWEEN,
    })
    return (
      <>
        <AnimatePresence ref={presence} {...mounting}>
          <For each={items()}>{(id) => <div style={BOX} {...list.member(id, { ref: (el) => members.set(id, el as HTMLDivElement) })} />}</For>
        </AnimatePresence>
        <AnimatePresence {...mounting}>
          <For each={items()}>
            {(id, i) => (
              <w.div
                ref={(el: HTMLDivElement) => wards.set(id, el)}
                style={BOX}
                initial={{ opacity: 0 }}
                animate={{ x: i() * 40, opacity: 1 }}
                exit={{ opacity: 0, transition: { type: "tween", duration: 0.2, delay: rankOf(id) * 0.1 } }}
                transition={TWEEN}
                key={id}
              />
            )}
          </For>
        </AnimatePresence>
      </>
    )
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  // The list as the test last set it, read outside any tracking.
  return { listed: () => untrack(items), setItems, members, wards, presence: () => presence }
}

/** One frame's reads of each id's member and ward: `x`, `opacity`, and whether it's on the page. */
type Reads = ReadonlyArray<readonly [member: readonly [number, number, boolean], ward: readonly [number, number, boolean]]>

/** `frames` frames of `ids`' members and wards, read after each frame. */
const readsOver = async (frames: number, ids: ReadonlyArray<string>, both: ReturnType<typeof mountBoth>): Promise<ReadonlyArray<Reads>> => {
  const read = (el: Element): readonly [number, number, boolean] => [xOf(el), opacityOf(el), el.isConnected]
  const out: Array<Reads> = []
  for (let f = 0; f < frames; f++) {
    await raf()
    out.push(ids.map((id) => [read(both.members.get(id) as Element), read(both.wards.get(id) as Element)] as const))
  }
  return out
}

/** Each frame's member as its ward: `x` and `opacity` within 1e-6, on the page together. */
const expectSame = (frames: ReadonlyArray<Reads>): void =>
  frames.forEach((reads, f) =>
    reads.forEach(([member, ward], n) => {
      expect(member[2], `frame ${f}, item ${n}: on the page`).toBe(ward[2])
      expect(member[0], `frame ${f}, item ${n}: x`).toBeCloseTo(ward[0], 6)
      expect(member[1], `frame ${f}, item ${n}: opacity`).toBeCloseTo(ward[1], 6)
    }))

describe("a keyed Batch's exits under AnimatePresence on Solid 2 (#665)", () => {
  it("CVE1: two leave: each exits as its w.div does and goes as its exit lands; the presence handle hears them", async () => {
    const both = mountBoth(["a", "b", "c", "d"], (id) => Number(id === "c"))
    await readsOver(30, ["a", "b", "c", "d"], both)
    const complete = both.presence().next("exitComplete")
    both.setItems(["a", "d"])
    await raf()
    expect(both.presence().exiting()).toBe(true)
    const frames = await readsOver(30, ["a", "b", "c", "d"], both)
    expectSame(frames)
    await expect(complete).resolves.toBeUndefined()
    expect(both.presence().exiting()).toBe(false)
    const goneAt = (n: number): number => frames.findIndex((reads) => !reads[n][0][2])
    expect(goneAt(2)).toBeGreaterThan(goneAt(1))
  })

  it("CVE2: a key back mid-exit: its old element goes at once; its new one takes the member over", async () => {
    const both = mountBoth(["a", "b", "c"], () => 0)
    await readsOver(30, ["a", "b", "c"], both)
    const leaving = { member: both.members.get("b") as Element, ward: both.wards.get("b") as Element }
    both.setItems(["a", "c"])
    await readsOver(6, ["a", "c"], both)
    both.setItems(["a", "b", "c"])
    await raf()
    expect([leaving.member.isConnected, leaving.ward.isConnected]).toEqual([false, false])
    const frames = await readsOver(30, ["a", "b", "c"], both)
    expectSame(frames)
    expect(frames[frames.length - 1].map(([member]) => member[1])).toEqual([1, 1, 1])
  })

  it("CVE3: initial={false}, mode=wait (held, unmoved), popLayout, and an exit function hearing custom", async () => {
    // initial={false}: the first render's members at their targets, as their wards.
    const quiet = mountBoth(["a", "b"], () => 0, { initial: false })
    const first = await readsOver(2, ["a", "b"], quiet)
    expectSame(first)
    expect(first[0].map(([member]) => member[1])).toEqual([1, 1])
    // mode="wait": c held off the page, unmoved, until b's exit lands, then on with its ward.
    const waits = mountBoth(["a", "b"], () => 0, { mode: "wait" })
    await readsOver(30, ["a", "b"], waits)
    waits.setItems(["a", "c"])
    const inlineX = (el: Element | undefined): number => new DOMMatrix((el as HTMLElement).style.transform || "none").m41
    const onPage = (el: Element | undefined): boolean => Bool.and(Predicate.isNotUndefined(el), (el as Element).isConnected)
    const held: Array<readonly [boolean, boolean, number]> = []
    for (let f = 0; f < 24; f++) {
      await raf()
      held.push([onPage(waits.members.get("c")), onPage(waits.wards.get("c")), inlineX(waits.members.get("c"))])
    }
    held.forEach(([member, ward], f) => expect(member, `frame ${f}`).toBe(ward))
    expect([held[0][0], held[held.length - 1][0]]).toEqual([false, true])
    held.filter(([member]) => !member).forEach(([, , x], f) => expect(x, `held frame ${f}`).toBe(0))
    // popLayout: the leaver out of the flow while it exits, as its ward.
    const pops = mountBoth(["a", "b", "c"], () => 0, { mode: "popLayout" })
    await readsOver(30, ["a", "b", "c"], pops)
    pops.setItems(["a", "c"])
    await raf()
    const position = (el: Element | undefined): string => getComputedStyle(el as Element).position
    expect([position(pops.members.get("b")), position(pops.wards.get("b"))]).toEqual(["absolute", "absolute"])
    // An exit function hears the presence's custom.
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const heard: Array<readonly [string, number, unknown]> = []
    const members = new Map<string, HTMLDivElement>()
    const Scene = (): JSX.Element => {
      const list = createBatch({
        each: items,
        key: (id) => id,
        animate: (_, i) => ({ x: i * 40 }),
        exit: (id, i, custom) => {
          heard.push([id, i, custom])
          return { x: custom as number }
        },
        transition: { type: "tween", duration: 0.1 },
      })
      return (
        <AnimatePresence custom={-50}>
          <For each={items()}>{(id) => <div style={BOX} {...list.member(id, { ref: (el) => members.set(id, el as HTMLDivElement) })} />}</For>
        </AnimatePresence>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    for (let f = 0; f < 20; f++) await raf()
    const b = members.get("b") as Element
    setItems(["a"])
    for (let f = 0; f < 3; f++) await raf()
    expect(xOf(b)).toBeLessThan(40)
    expect(heard).toEqual([["b", 1, -50]])
  })
})
