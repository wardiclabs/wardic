// A keyed Batch's exits under `<AnimatePresence>` on Solid 1 (#665, PR 3b, Q46–Q48): each member that
// leaves the list plays its `exit`, its element kept on the page until it lands, held to a `wardic.div`
// with the same exit under its own presence, frame for frame.
//
// - CE1: two items leave in one change: each member's exit, staggered by its rank among the leavers, draws
//   what its `wardic.div` (delayed by that rank) draws, frame for frame; each element goes the frame its own
//   exit lands, as its ward's does; the members that stay close up as their wards do; each presence tells
//   `onExitComplete` once.
// - CE2: a key back mid-exit: its old element goes at once, uncompleted, and its new one takes the
//   member over where it was, at its speed, turning toward `animate`, as a keyed `wardic.div` takes over (#286).
// - CE3: `initial={false}` starts the first render's members at their targets, a later one from `initial`;
//   `mode="wait"` holds an entering element until the leaver's exit lands; `popLayout` pops the leaver
//   out of the flow: each as its ward's.
// - CE4: `exit` as a function of the item, its last index and the presence's `custom`.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as Predicate from "effect/Predicate"
import { AnimatePresence, createBatch, type PresenceMode, stagger, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { width: "40px", height: "40px", background: "teal" }
const TWEEN = { type: "tween", duration: 0.3 } as const

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** How `mountBoth` mounts its presences: their mode and `initial`. */
interface Mounting {
  readonly mode?: PresenceMode
  readonly initial?: boolean
}

/**
 * A keyed Batch of `start`'s items under one `<AnimatePresence>`, and a `wardic.div` for each under another,
 * each entering from `opacity: 0` to `x: i * 40, opacity: 1`, leaving to `opacity: 0` on a 0.2 s tween,
 * a member staggered by its rank among the leavers, a ward by `rankOf(id)`.
 */
const mountBoth = (start: ReadonlyArray<string>, rankOf: (id: string) => number, mounting: Mounting = {}) => {
  const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
  const members = new Map<string, HTMLDivElement>()
  const wards = new Map<string, HTMLDivElement>()
  const completes = { members: 0, wards: 0 }
  const Scene = (): JSX.Element => {
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
        <AnimatePresence {...mounting} onExitComplete={() => completes.members++}>
          <For each={items()}>{(id) => <div data-member={id} style={BOX} {...list.member(id, { ref: (el) => members.set(id, el as HTMLDivElement) })} />}</For>
        </AnimatePresence>
        <AnimatePresence {...mounting} onExitComplete={() => completes.wards++}>
          <For each={items()}>
            {(id, i) => (
              <wardic.div
                data-ward={id}
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
  render(() => (
    <WardicProvider env={DomLive}>
      <Scene />
    </WardicProvider>
  ))
  return { items, setItems, members, wards, completes }
}

/** Whether an element is made and on the page. */
const isOnPage = (el: Element | undefined): boolean => Predicate.isNotUndefined(el) && el.isConnected

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

describe("a keyed Batch's exits under AnimatePresence on Solid 1 (#665)", () => {
  it("CE1: two leave: each exits as its wardic.div does, staggered by its rank, and goes as its exit lands", async () => {
    // b and c leave, ranks 0 and 1 of 2.
    const both = mountBoth(["a", "b", "c", "d"], (id) => Number(id === "c"))
    await readsOver(30, ["a", "b", "c", "d"], both)
    both.setItems(["a", "d"])
    const frames = await readsOver(30, ["a", "b", "c", "d"], both)
    expectSame(frames)
    // b goes before c: each as its own exit lands.
    const goneAt = (n: number): number => frames.findIndex((reads) => !reads[n][0][2])
    expect(goneAt(1)).toBeGreaterThan(0)
    expect(goneAt(2)).toBeGreaterThan(goneAt(1))
    // a and d close up; b and c are gone.
    const last = frames[frames.length - 1]
    expect([last[0][0][0], last[3][0][0], last[1][0][2], last[2][0][2]]).toEqual([0, 40, false, false])
    expect(both.completes).toEqual({ members: 1, wards: 1 })
  })

  it("CE2: a key back mid-exit: its old element goes at once, uncompleted; its new one takes the member over", async () => {
    const both = mountBoth(["a", "b", "c"], () => 0)
    await readsOver(30, ["a", "b", "c"], both)
    const leaving = { member: both.members.get("b") as Element, ward: both.wards.get("b") as Element }
    both.setItems(["a", "c"])
    await readsOver(6, ["a", "c"], both)
    both.setItems(["a", "b", "c"])
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect([leaving.member.isConnected, leaving.ward.isConnected]).toEqual([false, false])
    expect(both.members.get("b")).not.toBe(leaving.member)
    const frames = await readsOver(30, ["a", "b", "c"], both)
    expectSame(frames)
    expect(frames[frames.length - 1].map(([member]) => member[1])).toEqual([1, 1, 1])
    expect(both.completes).toEqual({ members: 0, wards: 0 })
  })

  it("CE3: initial={false}, mode=wait and popLayout, each as its ward's", async () => {
    // initial={false}: the first render's members at their targets; one added later from `initial`.
    const quiet = mountBoth(["a", "b"], () => 0, { initial: false })
    const first = await readsOver(2, ["a", "b"], quiet)
    expectSame(first)
    expect(first[0].map(([member]) => member[1])).toEqual([1, 1])
    quiet.setItems(["a", "b", "c"])
    expectSame(await readsOver(30, ["a", "b", "c"], quiet))
    cleanup()
    // mode="wait": c waits for b's exit to land, as its ward does.
    const waits = mountBoth(["a", "b"], () => 0, { mode: "wait" })
    await readsOver(30, ["a", "b"], waits)
    waits.setItems(["a", "c"])
    const onPage = async (frames: number): Promise<ReadonlyArray<readonly [boolean, boolean]>> => {
      const out: Array<readonly [boolean, boolean]> = []
      for (let f = 0; f < frames; f++) {
        await raf()
        out.push([isOnPage(waits.members.get("c")), isOnPage(waits.wards.get("c"))])
      }
      return out
    }
    const held = await onPage(30)
    held.forEach(([member, ward], f) => expect(member, `frame ${f}`).toBe(ward))
    expect([held[0][0], held[held.length - 1][0]]).toEqual([false, true])
    cleanup()
    // popLayout: the leaver out of the flow while it exits.
    const pops = mountBoth(["a", "b", "c"], () => 0, { mode: "popLayout" })
    await readsOver(30, ["a", "b", "c"], pops)
    pops.setItems(["a", "c"])
    await raf()
    const position = (el: Element | undefined): string => getComputedStyle(el as Element).position
    expect([position(pops.members.get("b")), position(pops.wards.get("b"))]).toEqual(["absolute", "absolute"])
  })

  it("CE4: exit as a function of the item, its last index and the presence's custom", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const members = new Map<string, HTMLDivElement>()
    const heard: Array<readonly [string, number, unknown]> = []
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
    render(() => (
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
