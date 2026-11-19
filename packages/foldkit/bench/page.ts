/**
 * `bench:foldkit`'s page (#795, ADR-0071 *Amendment (#795)*, Q11): N elements, each with a numeric leg
 * (`opacity`) and a string leg (`background-color`), all following one target in the Model. `?kind=wardic`
 * is N `w.div`s on a Handle over `DomLive`; `?kind=plain` is N plain `h.div`s whose `h.Style` binds the
 * same Model: Foldkit without Wardic, the baseline and the noise control, the same code on both sides of
 * a comparison.
 *
 * On Foldkit a change is a Message: the runtime runs `update`, renders the view and patches the DOM in a
 * frame of its own, and a `w.*` element's Mount runs in the patch. So a task is timed from the view's
 * call to the end of the patch's task: a full GC as the view is called, then the clock from there to the
 * first microtask after the patch, which the render, the patch and the elements' Mounts run before. Per
 * round:
 * - **mount:** the Message that shows N elements: Foldkit's render and patch of N new elements, and
 *   their Mounts, 2N Leg starts among them.
 * - **firstFrame:** the frame after it, from its first rAF callback to just after its paint: the Legs'
 *   first step, the gate's first commits and rendering. Reported, not gated.
 * - **retarget:** the Message retargeting all N mid-flight: the render, the patch of N elements whose
 *   attributes changed, and 2N interrupts and 2N starts in their deliveries.
 * - **restRetarget:** the same once every Leg has settled, 90 frames on (`bench:solid`'s rule).
 * - **render:** at rest, a Message that changes the Model but leaves every target as it is: Foldkit
 *   renders and patches N elements, and Wardic's deliveries find nothing changed. What a page pays for a
 *   render that touches nothing of Wardic's.
 * - **unmount:** the Message hiding them mid-flight: the patch's N removals, and 2N interrupts in the
 *   Mounts' releases.
 *
 * The runner starts Chromium with `--expose-gc`; what a side allocates is held by its bytes gate.
 */
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Schema from "effect/Schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Port from "foldkit/port"
import * as Runtime from "foldkit/runtime"
import * as Subscription from "foldkit/subscription"
import * as Wardic from "@wardic/foldkit/Wardic"

const WHITE = "rgb(255, 255, 255)"
const BLUE = "rgb(0, 0, 255)"
const RED = "rgb(255, 0, 0)"

const params = new URLSearchParams(location.search)
const n = Number(params.get("n") ?? "1000")
const kind = params.get("kind") ?? "wardic"
const items = Array.from({ length: n }, (_, i) => i)

const style = document.createElement("style")
style.textContent = ".b{display:inline-block;width:8px;height:8px}"
document.head.append(style)

/** The Model: whether the elements are shown, their target, and a count a `render` round changes alone. */
const Model = Schema.Struct({ shown: Schema.Boolean, o: Schema.Number, c: Schema.String, tick: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Set: { model: Model } })
type Message = typeof Message.Type

const wardic = Wardic.make({ env: DomLive })

const exposedGc = (globalThis as { gc?: () => void }).gc
if (exposedGc === undefined) throw new Error("bench:foldkit: the page needs Chromium's --js-flags=--expose-gc")
const gc: () => void = exposedGc

/** The task being timed: resolved with its ms by the first microtask after the patch the view's call starts. */
let timing: ((ms: number) => void) | undefined
const timedView = (): void => {
  const resolve = timing
  if (resolve === undefined) return
  timing = undefined
  gc()
  const t0 = performance.now()
  queueMicrotask(() => resolve(performance.now() - t0))
}

/** N `w.div`s under a `w.div` host, which stays through the rounds so the Handle's services do too. */
const wardicView = (model: Model, h: HtmlBuilder<Message>): Html => {
  timedView()
  const w = wardic.html(h)
  return w.div([h.Class("host")], Bool.match(model.shown, {
    onTrue: () => items.map(() => w.div([h.Class("b"), w.Initial({ opacity: 0, "background-color": "rgb(0, 0, 0)" }), w.Animate({ opacity: model.o, "background-color": model.c })], [])),
    onFalse: (): ReadonlyArray<Html> => [],
  }))
}

/** N plain `h.div`s whose style binds the Model: the control, the same on both sides. */
const plainView = (model: Model, h: HtmlBuilder<Message>): Html => {
  timedView()
  return h.div([h.Class("host")], Bool.match(model.shown, {
    onTrue: () => items.map(() => h.div([h.Class("b"), h.Style({ opacity: String(model.o), "background-color": model.c })], [])),
    onFalse: (): ReadonlyArray<Html> => [],
  }))
}

const host = document.createElement("div")
document.body.append(host)
const container = document.createElement("div")
container.id = "bench"
host.append(container)
const set = Port.inbound(Model)
const element = Runtime.makeElement({
  Model,
  init: () => ({ model: { shown: false, o: 1, c: WHITE, tick: 0 } }),
  update: (_model: Model, message: Message) => Message.match(message, { Set: ({ model }) => ({ model }) }),
  view: Bool.match(kind === "plain", { onTrue: () => plainView, onFalse: () => wardicView }),
  container,
  ports: { inbound: { set } },
  subscriptions: Subscription.make<Model, Message>()(() => ({ set: Port.subscriptionEntry(set, (model: Model) => Message.Set({ model })) })),
})
const handle = Runtime.embed(element)

let current: Model = { shown: false, o: 1, c: WHITE, tick: 0 }
/** Send `change` to the Model and time the render and patch it causes, in ms. */
const timed = (change: Partial<Model>): Promise<number> =>
  new Promise((resolve) => {
    timing = resolve
    current = { ...current, ...change }
    handle.ports.set.send(current)
  })

const realRaf = window.requestAnimationFrame.bind(window)
const frames = (k: number): Promise<void> =>
  new Promise((resolve) => {
    let i = 0
    const f = (): void => {
      if (++i >= k) resolve()
      else realRaf(f)
    }
    realRaf(f)
  })
const afterPaint = (): Promise<void> => new Promise((resolve) => realRaf(() => setTimeout(resolve, 0)))
/** The next frame, from its first rAF callback to just after its paint, in ms. */
const nextFrame = (): Promise<number> =>
  new Promise((resolve) => {
    realRaf(() => {
      const t0 = performance.now()
      setTimeout(() => resolve(performance.now() - t0), 0)
    })
  })

const boxes = (): ReadonlyArray<HTMLElement> => [...host.querySelectorAll<HTMLElement>(".b")]
const at = (o: number, c: string): boolean => boxes().every((el) => el.style.opacity === String(o) && el.style.backgroundColor === c)
const until = async (done: () => boolean, timeoutMs = 10000): Promise<void> => {
  const end = performance.now() + timeoutMs
  while (!done()) {
    if (performance.now() > end) throw new Error("bench:foldkit: timed out")
    await frames(1)
  }
}

/** One round's tasks, in ms. */
export interface Round {
  readonly mount: number
  readonly firstFrame: number
  readonly retarget: number
  readonly restRetarget: number
  readonly render: number
  readonly unmount: number
}

const round = async (): Promise<Round> => {
  await afterPaint()
  const mount = await timed({ shown: true, o: 1, c: WHITE })
  if (boxes().length !== n) throw new Error(`bench:foldkit: mounted ${boxes().length} of ${n}`)
  const firstFrame = await nextFrame()
  await frames(7)
  if (kind !== "plain" && !boxes().some((el) => Number(el.style.opacity) > 0 && Number(el.style.opacity) < 1)) {
    throw new Error("bench:foldkit: not mid-flight at the Retarget")
  }
  await afterPaint()
  const retarget = await timed({ o: 0.5, c: BLUE })
  await until(() => at(0.5, BLUE))
  await frames(90)
  await afterPaint()
  const restRetarget = await timed({ o: 0.2, c: RED })
  await until(() => at(0.2, RED))
  await frames(90)
  await afterPaint()
  const render = await timed({ tick: current.tick + 1 })
  if (!at(0.2, RED)) throw new Error("bench:foldkit: the render moved a target")
  await afterPaint()
  const retargetAgain = await timed({ o: 0.6, c: BLUE })
  void retargetAgain
  await frames(5)
  await afterPaint()
  const unmount = await timed({ shown: false })
  if (boxes().length !== 0) throw new Error("bench:foldkit: still mounted")
  // The loop drops its Clock subscription, and the Clock idles, before the next round's mount.
  await frames(6)
  return { mount, firstFrame, retarget, restRetarget, render, unmount }
}

;(globalThis as unknown as { __wardicBenchFoldkit: unknown }).__wardicBenchFoldkit = async (rounds: number): Promise<ReadonlyArray<Round>> => {
  await frames(5)
  const out: Array<Round> = []
  for (let i = 0; i < rounds; i++) out.push(await round())
  return out
}
