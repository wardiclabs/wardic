// A swipe-to-dismiss card on Solid 2 (#257, ADR-0046): the README's pattern, run end to end. A
// release far enough or fast enough flies the card out; once it has landed off screen, an undo
// window, then the request; then the list without it. One `action` holds the sequence, with the
// card's side and the undo button as optimistic values: whichever way the action ends, they revert.
//
// - SC1: the request goes out only once the card has landed off screen (opacity 0), and the card
//   leaves the list without flashing back between its landing and its removal.
// - SC2: a failed request: the action throws, the optimistic side reverts, and the card flies back.
// - SC3: an undo in the window: the action returns, the card flies back, and no request is sent.
// - SC4: a short swipe: it snaps back, and nothing is sent.
// - SC5 (#257 item 4): a fly-out that fails (its own duration from a speed setting that's NaN): the
//   action's `next("settled")` rejects, so it throws: a toast, no request, and the loop goes on, so a
//   second swipe fails and says so too, and one with the setting fixed dismisses the card. On main the
//   first action waited for good, and the loop with it: every later swipe was ignored, silently.
import { DomLive } from "@wardic/dom"
import { type WardDragInfo, ward, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import * as UndefinedOr from "effect/UndefinedOr"
import type { JSX } from "@solidjs/web"
import { action, createMemo, createOptimistic, createSignal, For, Loading, onSettled, refresh, Show, type SourceAccessor } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

type Side = "left" | "right"
const SWIPE = { shown: { x: 0, opacity: 1 }, left: { x: -420, opacity: 0 }, right: { x: 420, opacity: 0 } }
const TWEEN = { type: "tween", duration: 0.1 } as const
const UNDO_MS = 150

/** The swipe's variants, the fly-outs on their own transition at `speed`'s pace when it's given (SC5). */
const variantsAt = (speed: (() => number) | undefined) =>
  UndefinedOr.match(speed, {
    onUndefined: () => SWIPE,
    onDefined: (pace) => {
      const flyOut = { type: "tween", duration: TWEEN.duration * pace() } as const
      return { ...SWIPE, left: { ...SWIPE.left, transition: flyOut }, right: { ...SWIPE.right, transition: flyOut } }
    },
  })

const flung = (release: WardDragInfo): boolean => Math.abs(release.offset.x) >= 120 || Math.abs(release.velocity.x) >= 600
const sideOf = (release: WardDragInfo): Side => Bool.match(release.offset.x < 0, { onTrue: (): Side => "left", onFalse: () => "right" })

/** A server holding the list, with `dismiss` succeeding or failing; each call notes the card's opacity then. */
const makeApi = (outcome: "ok" | "fail") => {
  let server: ReadonlyArray<string> = ["a", "b"]
  const calls: Array<{ readonly id: string; readonly opacity: number }> = []
  const opacityOf = (id: string): number => Number(document.querySelector<HTMLElement>(`[data-id="${id}"]`)?.style.opacity)
  return {
    calls,
    list: (): Promise<ReadonlyArray<string>> => new Promise((resolve) => setTimeout(() => resolve(server), 5)),
    dismiss: (id: string): Promise<void> => {
      calls.push({ id, opacity: opacityOf(id) })
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          if (outcome === "fail") return reject(new Error("offline"))
          server = server.filter((each) => each !== id)
          resolve()
        }, 20))
    },
  }
}
type Api = ReturnType<typeof makeApi>

function NoticeCard(props: {
  readonly id: string
  readonly list: SourceAccessor<ReadonlyArray<string>>
  readonly api: Api
  readonly toast: (text: string) => void
  /** The fly-out's speed setting, a multiple of its duration (SC5): its variants carry their own transition. */
  readonly speed?: (() => number) | undefined
}): JSX.Element {
  // Optimistic: shown at once, reverted when the action ends, whichever way it ends.
  const [out, setOut] = createOptimistic<Side | undefined>(undefined)
  const [undoable, setUndoable] = createOptimistic(false)
  const card = ward({ drag: "x", dragSnapToOrigin: true, variants: () => variantsAt(props.speed), initial: "shown", animate: () => out() ?? "shown", transition: TWEEN })

  let undoNow = (): void => {}
  const dismiss = action(function* (side: Side) {
    setOut(side) //                                          1. fly out
    yield card.next("settled") //                             2. ...and land off screen
    setUndoable(true) //                                      3. "Dismissed · Undo"
    const undone: boolean = yield new Promise<boolean>((resolve) => {
      undoNow = () => resolve(true)
      setTimeout(() => resolve(false), UNDO_MS)
    })
    if (undone) return //                                        undone: the revert flies it back
    yield props.api.dismiss(props.id) //                      4. only now, the request
    refresh(props.list) //                                    5. the list, without it
  })

  onSettled(() => {
    void (async () => {
      for await (const release of card.each("dragEnd")) {
        if (flung(release)) await dismiss(sideOf(release)).catch(() => props.toast("Couldn't dismiss it"))
      }
    })()
  })

  return (
    <>
      <article {...card} data-id={props.id} style={{ width: "120px", height: "40px", "margin-left": "200px", "margin-top": "120px" }}>
        {props.id}
      </article>
      <Show when={undoable()}>
        <button data-undo={props.id} onClick={() => undoNow()}>
          Undo
        </button>
      </Show>
    </>
  )
}

/** Mount the list on `api`: the cards it lists, under a `<Loading>`; toasts recorded. */
const mountList = (api: Api, speed?: () => number) => {
  const toasts: Array<string> = []
  const { host } = mount(() => {
    const list = createMemo(() => api.list())
    return (
      <WardicProvider env={DomLive}>
        <Loading fallback={<p>loading</p>}>
          <For each={list()}>{(id) => <NoticeCard id={id} list={list} api={api} toast={(text) => toasts.push(text)} speed={speed} />}</For>
        </Loading>
      </WardicProvider>
    )
  })
  const card = (id: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-id="${id}"]`)
  return { host, toasts, card }
}

const pointer = (at: EventTarget, type: string, x: number, y: number, buttons = 0): void => {
  at.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, buttons, button: 0, bubbles: true }))
}

/**
 * Swipe `el` by `dx` from its middle in four moves a frame apart, released on the page: a real
 * gesture's pace, so its velocity is the pointer's (moves dispatched at once would read as a fling).
 */
const swipe = async (el: HTMLElement, dx: number): Promise<void> => {
  const box = el.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  pointer(el, "pointerdown", x, y, 1)
  for (const k of [1, 2, 3, 4]) {
    await raf()
    pointer(el, "pointermove", x + (dx * k) / 4, y, 1)
  }
  await raf()
  pointer(document.body, "pointerup", x + dx, y)
}

/** The opacity the gate last committed onto `el`. */
const opacity = (el: HTMLElement | null): number => Number(el?.style.opacity)

describe("a swipe-to-dismiss card, the request after the fly-out (#257)", () => {
  it("SC1: the request only once the card has landed off screen; the card leaves with no flash back", async () => {
    const api = makeApi("ok")
    const { card, host } = mountList(api)
    await until(() => card("a") !== null, 2000)
    await raf()
    await raf()
    await swipe(card("a")!, -200)
    // Watch the card each frame from its swipe to its removal.
    const seen: Array<number> = []
    await until(() => {
      const el = card("a")
      if (el !== null) seen.push(opacity(el))
      return el === null
    }, 3000)
    expect(card("a"), "it left the list").toBeNull()
    expect(api.calls).toEqual([{ id: "a", opacity: 0 }])
    // Once at 0 (landed), it never came back before its removal.
    const landedAt = seen.indexOf(0)
    expect(landedAt, "it landed off screen").toBeGreaterThanOrEqual(0)
    expect(Math.max(...seen.slice(landedAt)), "no flash back between the landing and the removal").toBe(0)
    expect(host.querySelector('[data-undo="a"]'), "the undo button went with it").toBeNull()
    expect(card("b"), "the other card stays").not.toBeNull()
  })

  it("SC2: a failed request: the card flies back by itself", async () => {
    const api = makeApi("fail")
    const { card, toasts } = mountList(api)
    await until(() => card("a") !== null, 2000)
    await raf()
    await raf()
    await swipe(card("a")!, 200)
    await until(() => toasts.length > 0, 3000)
    expect(toasts).toEqual(["Couldn't dismiss it"])
    expect(api.calls).toEqual([{ id: "a", opacity: 0 }])
    await until(() => opacity(card("a")) === 1, 2000)
    expect(opacity(card("a")), "back in").toBe(1)
  })

  it("SC3: an undo in the window: the card flies back, and no request is sent", async () => {
    const api = makeApi("ok")
    const { card, host } = mountList(api)
    await until(() => card("a") !== null, 2000)
    await raf()
    await raf()
    await swipe(card("a")!, -200)
    await until(() => host.querySelector('[data-undo="a"]') !== null, 2000)
    host.querySelector<HTMLButtonElement>('[data-undo="a"]')!.click()
    await until(() => opacity(card("a")) === 1, 2000)
    expect(opacity(card("a")), "back in").toBe(1)
    expect(host.querySelector('[data-undo="a"]'), "the undo button reverted").toBeNull()
    for (let i = 0; i < 12; i++) await raf()
    expect(api.calls, "no request").toEqual([])
  })

  it("SC5: a fly-out that fails (a speed setting of NaN): each swipe's action throws, a toast says so, and the card stays swipeable (#257 item 4)", async () => {
    const api = makeApi("ok")
    // A setting read from storage that came back empty: parseFloat("") is NaN, a duration Wardic rejects.
    const [speed, setSpeed] = createSignal(Number.parseFloat(""))
    // eslint-disable-next-line solid/reactivity -- read in NoticeCard's props, in JSX, where it tracks
    const { card, toasts } = mountList(api, speed)
    await until(() => card("a") !== null, 2000)
    await raf()
    await raf()
    await swipe(card("a")!, -200)
    await until(() => toasts.length > 0, 3000)
    expect(toasts, "next('settled') rejected, so the action threw").toEqual(["Couldn't dismiss it"])
    await until(() => opacity(card("a")) === 1, 2000)
    expect(opacity(card("a")), "back where it was").toBe(1)
    // The loop went on to the next release: a second swipe fails the same way, and says so. Before,
    // the first action waited for its landing for good, and the loop with it: every swipe after it
    // was ignored, with nothing on screen.
    await swipe(card("a")!, 200)
    await until(() => toasts.length > 1, 3000)
    expect(toasts).toEqual(["Couldn't dismiss it", "Couldn't dismiss it"])
    expect(api.calls, "no request for a card that never left").toEqual([])
    // With the setting fixed, the next swipe dismisses it.
    setSpeed(1)
    await until(() => opacity(card("a")) === 1, 2000)
    await raf()
    await swipe(card("a")!, -200)
    await until(() => card("a") === null, 3000)
    expect(card("a"), "it left the list").toBeNull()
    expect(api.calls).toEqual([{ id: "a", opacity: 0 }])
  })

  it("SC4: a short swipe snaps back, and nothing is sent", async () => {
    const api = makeApi("ok")
    const { card } = mountList(api)
    await until(() => card("a") !== null, 2000)
    await raf()
    await raf()
    await swipe(card("a")!, 40)
    for (let i = 0; i < 20; i++) await raf()
    expect(api.calls).toEqual([])
    expect(opacity(card("a"))).toBe(1)
  })
})
