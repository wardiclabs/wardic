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
//   `mode="wait"` holds an entering element until the leaver's exit lands, then it moves as its ward does,
//   a frame later; `popLayout` pops the leaver out of the flow: each as its ward's.
// - CE4: `exit` as a function of the item, its last index and the presence's `custom`.
// - CE5: an `exit` key `animate` doesn't give is one of the Batch's; members still in the list whose
//   presence child leaves exit, and their next elements enter from `initial`; under `mode="wait"`, a key
//   back mid-exit is on the page at once; a Batch disposed mid-exit lets its leavers go.
// - CE6: members on SVG `<rect>`s (#702, ADR-0048 *Amendment (#702)*): two leave, each staying for its
//   exit, staggered by its rank, and going as it lands; `onExitComplete` once; `mode="wait"` holds an
//   entering one off the page, unmoved, until the leaver's exit lands.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { AnimatePresence, createBatch, type PresenceMode, stagger, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
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
    // While held, the member doesn't move: the transform the Batch writes on its element stays at its start.
    const inlineX = (el: Element | undefined): number => new DOMMatrix((el as HTMLElement).style.transform || "none").m41
    const held: Array<readonly [boolean, boolean, number]> = []
    for (let f = 0; f < 24; f++) {
      await raf()
      held.push([isOnPage(waits.members.get("c")), isOnPage(waits.wards.get("c")), inlineX(waits.members.get("c"))])
    }
    held.forEach(([member, ward], f) => expect(member, `frame ${f}`).toBe(ward))
    expect([held[0][0], held[held.length - 1][0]]).toEqual([false, true])
    held.filter(([member]) => !member).forEach(([, , x], f) => expect(x, `held frame ${f}`).toBe(0))
    // On the page, it sets off, and lands within a frame of its ward. Let on inside the frame its leaver's exit
    // lands, the ward's run takes its first step in that frame's Late window (#680); the member's change is made
    // in the Batch's step, which has stepped, so it moves at the next.
    const on = await readsOver(20, ["c"], waits)
    const landedAt = (side: 0 | 1): number => on.findIndex((reads) => reads[0][side][0] === 40)
    expect(on[0][0][0][0]).toBeLessThan(40)
    expect(landedAt(0) - landedAt(1)).toBeLessThanOrEqual(1)
    expect(landedAt(0)).toBeGreaterThanOrEqual(landedAt(1))
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

  it("CE5: an exit-only key; a presence child leaving with members in it; wait and a key back; disposal mid-exit", async () => {
    const [items] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const [open, setOpen] = createSignal(true)
    const members = new Map<string, HTMLDivElement>()
    const Scene = (): JSX.Element => {
      // `x` only in `exit`: one of the Batch's keys all the same.
      const list = createBatch({
        each: items,
        key: (id) => id,
        initial: { opacity: 0 },
        animate: (_, i) => ({ y: i * 48, opacity: 1 }),
        exit: { opacity: 0, x: -24, transition: { type: "tween", duration: 0.2 } },
        transition: { type: "tween", duration: 0.2 },
      })
      return (
        <AnimatePresence>
          <Show when={open()}>
            <div data-box="list">
              <For each={items()}>{(id) => <div style={BOX} {...list.member(id, { ref: (el) => members.set(id, el as HTMLDivElement) })} />}</For>
            </div>
          </Show>
        </AnimatePresence>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    const frames = async (n: number): Promise<void> => {
      for (let f = 0; f < n; f++) await raf()
    }
    await frames(20)
    // The presence child leaves with both members still in the list: they exit, `x` included, and it goes.
    const box = document.querySelector("[data-box=list]") as Element
    const first = members.get("a") as Element
    setOpen(false)
    await frames(4)
    expect(xOf(first)).toBeLessThan(0)
    await frames(20)
    expect(box.isConnected).toBe(false)
    // Back: their next elements enter from `initial`, not from where their exits left them.
    setOpen(true)
    await raf()
    expect(members.get("a")).not.toBe(first)
    expect(opacityOf(members.get("a") as Element)).toBeLessThan(0.5)
    await frames(20)
    expect([opacityOf(members.get("a") as Element), xOf(members.get("a") as Element)]).toEqual([1, 0])
    cleanup()
    // mode="wait", a key back mid-exit: its old element goes at once, so the new one isn't held.
    const [keyed, setKeyed] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const waited = new Map<string, HTMLDivElement>()
    const Waits = (): JSX.Element => {
      const list = createBatch({ each: keyed, key: (id) => id, animate: () => ({ opacity: 1 }), exit: { opacity: 0, transition: { type: "tween", duration: 0.4 } } })
      return (
        <AnimatePresence mode="wait">
          <For each={keyed()}>{(id) => <div style={BOX} {...list.member(id, { ref: (el) => waited.set(id, el as HTMLDivElement) })} />}</For>
        </AnimatePresence>
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Waits />
      </WardicProvider>
    ))
    await frames(10)
    const leaving = waited.get("b") as Element
    setKeyed(["a"])
    await frames(4)
    setKeyed(["a", "b"])
    await raf()
    expect([leaving.isConnected, (waited.get("b") as Element).isConnected]).toEqual([false, true])
    cleanup()
    // A Batch disposed mid-exit: its leaver goes, the presence waiting on it no more.
    const [shown, setShown] = createSignal(true)
    const [gone, setGone] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const kept = new Map<string, HTMLDivElement>()
    const Inner = (): JSX.Element => {
      const list = createBatch({ each: gone, key: (id) => id, animate: () => ({ opacity: 1 }), exit: { opacity: 0, transition: { type: "tween", duration: 2 } } })
      return <For each={gone()}>{(id) => <div style={BOX} {...list.member(id, { ref: (el) => kept.set(id, el as HTMLDivElement) })} />}</For>
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <Inner />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(4)
    const b = kept.get("b") as Element
    setGone(["a"])
    await frames(2)
    expect(b.isConnected).toBe(true)
    setShown(false)
    await frames(4)
    expect(b.isConnected).toBe(false)
  })
  it("CE6: SVG members: two rects leave, staggered, each going as it lands; mode=wait holds an entering one, unmoved", async () => {
    const mountRects = (start: ReadonlyArray<string>, mode: PresenceMode = "sync") => {
      const [items, setItems] = createSignal<ReadonlyArray<string>>(start)
      const rects = new Map<string, SVGRectElement>()
      let completes = 0
      const Scene = (): JSX.Element => {
        const list = createBatch({
          each: items,
          key: (id) => id,
          initial: { opacity: 0 },
          animate: () => ({ opacity: 1 }),
          exit: { opacity: 0, transition: { type: "tween", duration: 0.3, delay: stagger(0.1) } },
          transition: TWEEN,
        })
        return (
          <svg width="200" height="50">
            <AnimatePresence mode={mode} onExitComplete={() => completes++}>
              <For each={items()}>
                {(id, i) => <rect width="40" height="40" x={i() * 50} {...list.member<SVGRectElement>(id, { ref: (el) => rects.set(id, el) })} />}
              </For>
            </AnimatePresence>
          </svg>
        )
      }
      render(() => (
        <WardicProvider env={DomLive}>
          <Scene />
        </WardicProvider>
      ))
      return { setItems, rects, completes: () => completes }
    }
    const settle = async (n: number): Promise<void> => {
      for (let f = 0; f < n; f++) await raf()
    }

    const leaving = mountRects(["a", "b", "c"])
    await settle(30)
    const b = leaving.rects.get("b") as SVGRectElement
    const c = leaving.rects.get("c") as SVGRectElement
    expect(b).toBeInstanceOf(SVGRectElement)
    leaving.setItems(["a"])
    await raf()
    expect([b.isConnected, c.isConnected], "both stay for their exits").toEqual([true, true])
    let staggered = false
    let bWentFirst = false
    for (let f = 0; f < 60; f++) {
      await raf()
      if (Bool.and(b.isConnected, opacityOf(c) - opacityOf(b) > 0.1)) staggered = true
      if (Bool.and(Bool.not(b.isConnected), c.isConnected)) bWentFirst = true
    }
    expect(staggered, "c's exit starts a rank after b's").toBe(true)
    expect(bWentFirst, "b goes as its own exit lands, before c").toBe(true)
    expect([b.isConnected, c.isConnected]).toEqual([false, false])
    expect(leaving.completes(), "onExitComplete once").toBe(1)
    cleanup()

    const waiting = mountRects(["a"], "wait")
    await settle(30)
    const a = waiting.rects.get("a") as SVGRectElement
    waiting.setItems(["b"])
    await settle(3)
    expect(a.isConnected, "a exits").toBe(true)
    expect(Bool.and(waiting.rects.has("b"), (waiting.rects.get("b") as SVGRectElement).isConnected), "b waits off the page").toBe(false)
    for (let f = 0; f < 60; f++) {
      await raf()
      if (Bool.and(waiting.rects.has("b"), (waiting.rects.get("b") as SVGRectElement).isConnected)) break
    }
    const held = waiting.rects.get("b") as SVGRectElement
    expect(held.isConnected, "b goes on once a has gone").toBe(true)
    expect(a.isConnected).toBe(false)
    expect(opacityOf(held), "b starts its entrance on the page, not while held").toBeLessThan(0.5)
  })
})
