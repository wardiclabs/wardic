// wardic.create(Component) across component shapes (ADR-0021, decision 6), client-only
// under DomLive. Forwarding the ref stays the one requirement, and frames go through it
// (ADR-0006's commit sink). Until its first frame is committed the wrap passes the
// component `style` = the user's style + the Starting style + the drag defaults (and
// `draggable`); from then on, only the user's style over the drag defaults (an empty style
// when there's neither, so Solid removes only the Starting style's keys). Solid's style()
// writes every key again on a change, so the Starting style can't stay on the prop: a
// user-style change would reset the animated keys.
//
// Each shape animates `opacity` 0 -> 1 with a short tween. The visible opacity is the
// root's computed opacity times the inner element's (1 without one), read at the first
// paint (a ResizeObserver callback, after layout and before paint), on Refresh frames to
// the settle, and after the user's own style changes.
import { cleanup, render } from "@solidjs/testing-library"
import * as Renderer from "@wardic/core/Renderer"
import { DomLive } from "@wardic/dom"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as Style from "@wardic/dom/Style"
import { wardic, type WardicMotionProps, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import { type Component, createRenderEffect, createSignal, ErrorBoundary, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

/** The props a wrapped component receives from wardic.create. */
interface ShapeProps {
  readonly ref?: (el: HTMLElement) => void
  readonly style?: JSX.CSSProperties
  readonly draggable?: "false" | "true"
}

type ShapeName = "ref only" | "ref + style on root" | "ref on root, style on inner" | "reads props.style once" | "style but no ref"

const SHAPES: Record<ShapeName, Component<ShapeProps>> = {
  "ref only": (p) => (
    <div data-k="root" ref={p.ref}>
      x
    </div>
  ),
  "ref + style on root": (p) => (
    <div data-k="root" ref={p.ref} style={p.style}>
      x
    </div>
  ),
  "ref on root, style on inner": (p) => (
    <div data-k="root" ref={p.ref}>
      <span data-k="inner" style={p.style}>
        x
      </span>
    </div>
  ),
  "reads props.style once": (p) => {
    const style = p.style
    return (
      <div data-k="root" ref={p.ref} style={style}>
        x
      </div>
    )
  },
  "style but no ref": (p) => (
    <div data-k="root" style={p.style}>
      x
    </div>
  ),
}

/** Each shape wrapped once, as an app would at module scope. */
const WRAPPED = Object.fromEntries(
  Object.entries(SHAPES).map(([name, shape]) => [name, wardic.create(shape)]),
) as Record<ShapeName, Component<ShapeProps & WardicMotionProps>>

const INITIAL = { opacity: 0 }
const ANIMATE = { opacity: 1 }
const TWEEN: WardicTransition = { type: "tween", duration: 0.3 }
const TWEEN_MS = 300

/**
 * The most a frame showing the Starting style can read: the first Refresh frame's tick
 * paints its value in that frame (ADR-0033), so the first committed value is one
 * nominal frame into the tween (1/18 of 0.3 s). A flash reads 1.
 */
const FIRST_FRAME = 0.1

/** The DOM's projection, from the Renderer DomLive provides. */
const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), DomRenderer.layer)).project

const opacityOf = (el: Element | null): number =>
  Option.match(Option.fromNullOr(el), { onNone: () => 1, onSome: (node) => Number(getComputedStyle(node).opacity) })

/** The opacity the user sees: the root's times the inner element's. */
const visible = (host: HTMLElement): number =>
  opacityOf(host.querySelector("[data-k=root]")) * opacityOf(host.querySelector("[data-k=inner]"))

/** `read()` at the next rendering update, after layout and before paint (a ResizeObserver probe). */
const atFirstPaint = <A,>(read: () => A): Promise<A> =>
  new Promise((resolve) => {
    const probe = document.createElement("i")
    document.body.append(probe)
    const observer = new ResizeObserver(() => {
      observer.disconnect()
      probe.remove()
      resolve(read())
    })
    observer.observe(probe)
  })

/** `read()` just after each of the next `n` frames has painted (a rAF that posts a message). */
const afterPaints = <A,>(n: number, read: () => A): Promise<ReadonlyArray<A>> =>
  new Promise((resolve) => {
    const out: Array<A> = []
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      out.push(read())
      if (out.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(out)
    }
    requestAnimationFrame(post)
  })

interface Mounted {
  readonly host: HTMLElement
  readonly setColor: (color: string) => void
  readonly error: () => unknown
  /** When it mounted (`performance.now()`). */
  readonly at: number
}

/**
 * Where a mount runs. `"task"`: an ordinary task, so the next rendering update runs the
 * gate's first flush before it paints. `"frame"`: inside a Refresh frame (a rAF
 * callback's continuation, as a mount driven by a frame-time state change is), so this
 * frame paints the new element before the gate's first flush: an element without its
 * Starting style shows its unanimated style for that frame.
 */
type MountTiming = "task" | "frame"

const enter = (timing: MountTiming): Promise<void> =>
  Bool.match(timing === "frame", { onTrue: () => raf(), onFalse: () => new Promise<void>((resolve) => setTimeout(resolve, 0)) })

/** Mount `name` wrapped with opacity 0 -> 1 and a user style `{ color }` the test can change. */
const mountShape = (name: ShapeName, options: { readonly drag?: "x"; readonly layout?: true } = {}): Mounted => {
  const [color, setColor] = createSignal("red")
  let error: unknown
  const Wrapped = WRAPPED[name]
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <ErrorBoundary
        fallback={(e) => {
          error = e
          return <i data-k="error" />
        }}
      >
        <Wrapped
          initial={INITIAL}
          animate={ANIMATE}
          transition={TWEEN}
          style={{ color: color() }}
          {...UndefinedOr.match(options.drag, { onUndefined: () => ({}), onDefined: (drag) => ({ drag }) })}
          {...Bool.match(options.layout === true, { onTrue: () => ({ layout: true }), onFalse: () => ({}) })}
        />
      </ErrorBoundary>
    </WardicProvider>
  ))
  return { host: container, setColor, error: () => error, at: performance.now() }
}

/**
 * Poll Refresh frames until the tween's duration has passed since mount and the visible
 * opacity reads 1 (at most 2 s); every frame's read. The duration gate keeps a frame
 * that shows no Starting style yet (it reads 1) from passing for the settle.
 */
const toSettle = async ({ at, host }: Mounted): Promise<ReadonlyArray<number>> => {
  const reads: Array<number> = []
  await raf()
  await until(() => {
    reads.push(visible(host))
    return performance.now() - at >= TWEEN_MS && reads[reads.length - 1]! >= 0.99
  }, 2000)
  return reads
}

describe("wardic.create(Component) shapes (ADR-0021, decision 6)", () => {
  it("CS1 (guard): a component that forwards its ref only animates 0 -> 1", async () => {
    const mounted = mountShape("ref only")
    const reads = [await atFirstPaint(() => visible(mounted.host)), ...(await toSettle(mounted))]
    expect(Math.min(...reads), "it starts from its Starting style").toBeLessThanOrEqual(FIRST_FRAME)
    expect(reads.some((v) => v > 0.05 && v < 0.95), "it passes through").toBe(true)
    expect(reads[reads.length - 1]).toBeGreaterThanOrEqual(0.99)
  })

  it("CS2: ref + style on its root, mounted inside a frame: the first paint shows 0, it settles at 1, and a user-style change keeps 1", async () => {
    await enter("frame")
    const mounted = mountShape("ref + style on root")
    const { host, setColor } = mounted
    expect(await atFirstPaint(() => visible(host)), "first paint").toBeLessThanOrEqual(FIRST_FRAME)
    await toSettle(mounted)
    expect(visible(host), "settled").toBeGreaterThanOrEqual(0.99)
    setColor("blue")
    const reads = await afterPaints(3, () => visible(host))
    expect(reads.every((v) => v >= 0.99), `after the user's style changed: ${reads.join(", ")}`).toBe(true)
    expect(host.querySelector<HTMLElement>("[data-k=root]")?.style.color).toBe("blue")
  })

  it("CS3 (guard): ref on the root, style on an inner element: the root reaches 1 and the content ends visible", async () => {
    const mounted = mountShape("ref on root, style on inner")
    const { host, setColor } = mounted
    await toSettle(mounted)
    expect(opacityOf(host.querySelector("[data-k=root]")), "root").toBeGreaterThanOrEqual(0.99)
    expect(opacityOf(host.querySelector("[data-k=inner]")), "inner").toBeGreaterThanOrEqual(0.99)
    setColor("blue")
    const reads = await afterPaints(3, () => visible(host))
    expect(reads.every((v) => v >= 0.99), `after the user's style changed: ${reads.join(", ")}`).toBe(true)
  })

  it("CS4 (guard): a component that reads props.style once ends visible", async () => {
    const mounted = mountShape("reads props.style once")
    const { host, setColor } = mounted
    await toSettle(mounted)
    expect(visible(host), "settled").toBeGreaterThanOrEqual(0.99)
    setColor("blue")
    const reads = await afterPaints(3, () => visible(host))
    expect(reads.every((v) => v >= 0.99), `after the user's style changed: ${reads.join(", ")}`).toBe(true)
  })

  it("CS5 (guard): a component with style but no ref throws 'did not forward its ref' at mount", () => {
    const { error } = mountShape("style but no ref")
    expect(error()).toBeInstanceOf(Error)
    expect((error() as Error).message).toContain("did not forward its ref")
  })

  it("CS6: the component's style and draggable props before the first commit, then after", async () => {
    const spy = async (options: { readonly style?: JSX.CSSProperties; readonly drag?: "x" }) => {
      const log: Array<{ readonly style: Record<string, unknown> | undefined; readonly draggable: unknown }> = []
      const Spy = (p: ShapeProps): JSX.Element => {
        createRenderEffect(() => {
          const style = p.style as Record<string, unknown> | undefined
          log.push({ style: UndefinedOr.map(style, (s) => ({ ...s })), draggable: p.draggable })
        })
        return (
          <div data-k="root" ref={p.ref} style={p.style} draggable={p.draggable}>
            x
          </div>
        )
      }
      const Wrapped = wardic.create(Spy)
      render(() => (
        <WardicProvider env={DomLive}>
          <Wrapped
            initial={INITIAL}
            animate={ANIMATE}
            transition={TWEEN}
            {...UndefinedOr.match(options.style, { onUndefined: () => ({}), onDefined: (style) => ({ style }) })}
            {...UndefinedOr.match(options.drag, { onUndefined: () => ({}), onDefined: (drag) => ({ drag }) })}
          />
        </WardicProvider>
      ))
      for (let i = 0; i < 3; i++) await raf()
      return { before: log[0], after: log[log.length - 1] }
    }
    const starting = domProject(INITIAL)

    const plain = await spy({ style: { color: "red" } })
    expect(plain.before?.style, "before the first commit: the user's style + the Starting style").toEqual({ color: "red", ...starting })
    expect(plain.before?.draggable).toBeUndefined()
    expect(plain.after?.style, "after it: the user's style").toEqual({ color: "red" })
    expect(plain.after?.draggable).toBeUndefined()

    const drag = await spy({ style: { color: "red" }, drag: "x" })
    expect(drag.before?.style, "before the first commit, with drag: + the drag defaults").toEqual({ ...Style.dragDefaults("x"), color: "red", ...starting })
    expect(drag.before?.draggable).toBe("false")
    expect(drag.after?.style, "after it, with drag: the user's style over the drag defaults").toEqual({ ...Style.dragDefaults("x"), color: "red" })
    expect(drag.after?.draggable).toBe("false")

    const bare = await spy({})
    expect(bare.before?.style, "before the first commit, no user style: the Starting style").toEqual(starting)
    expect(bare.after?.style, "after it, no user style and no drag: an empty style (not undefined, which removes the attribute)").toEqual({})
    expect(bare.after?.draggable).toBeUndefined()
  })

  it("CS7: no flash at the style switch: from the first paint, the visible opacity starts at 0 and never drops", async () => {
    const flashes: Array<string> = []
    for (const name of ["ref + style on root", "reads props.style once"] as const) {
      for (const timing of ["task", "frame"] as const) {
        await enter(timing)
        const { host } = mountShape(name)
        const reads = [await atFirstPaint(() => visible(host)), ...(await afterPaints(3, () => visible(host)))]
        const starts = reads[0]! <= FIRST_FRAME
        const rises = reads.every((v, i) => i === 0 || v + 0.001 >= reads[i - 1]!)
        if (!starts || !rises) flashes.push(`${name}, mounted in a ${timing}: ${reads.join(", ")}`)
        cleanup()
      }
    }
    expect(flashes).toEqual([])
  })

  it("CS8 (guard): with drag='x', the element has the drag defaults after mount", async () => {
    const { host } = mountShape("ref + style on root", { drag: "x" })
    for (let i = 0; i < 3; i++) await raf()
    const el = host.querySelector<HTMLElement>("[data-k=root]")!
    expect(el.style.getPropertyValue("touch-action")).toBe("pan-y")
    expect(el.style.getPropertyValue("user-select")).toBe("none")
    expect(el.getAttribute("draggable")).toBe("false")
  })

  it("CS9: with no style of its own, the element keeps inline styles Wardic didn't write when the Starting style leaves", async () => {
    let node: HTMLElement | undefined
    const Wrapped = WRAPPED["ref + style on root"]
    render(() => (
      <WardicProvider env={DomLive}>
        <Wrapped
          ref={(el: HTMLElement) => {
            node = el
            el.style.setProperty("outline-color", "red")
          }}
          initial={INITIAL}
          animate={ANIMATE}
          transition={TWEEN}
        />
      </WardicProvider>
    ))
    for (let i = 0; i < 3; i++) await raf()
    expect(node?.style.getPropertyValue("outline-color"), "the ref callback's own style").toBe("red")
    expect(Number(node?.style.opacity), "and the commit's").toBeGreaterThan(0)
  })

  it("CS10: a layout component wrap mounted in a task or a frame: from the first paint, the visible opacity starts at 0 and never drops", async () => {
    const flashes: Array<string> = []
    for (const timing of ["task", "frame"] as const) {
      await enter(timing)
      const { host } = mountShape("ref + style on root", { layout: true })
      const reads = [await atFirstPaint(() => visible(host)), ...(await afterPaints(3, () => visible(host)))]
      const starts = reads[0]! <= FIRST_FRAME
      const rises = reads.every((v, i) => i === 0 || v + 0.001 >= reads[i - 1]!)
      if (!starts || !rises) flashes.push(`mounted in a ${timing}: ${reads.join(", ")}`)
      cleanup()
    }
    expect(flashes).toEqual([])
  })
})
