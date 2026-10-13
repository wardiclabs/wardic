// Fixtures for the hydration project (ADR-0021, decision 10). Each export is rendered on
// the server by the `serverRender` command (Solid's server build, in Node) and hydrated in
// Chromium from this same module (the hydratable client build), so both sides run the
// same code. Every fixture but F0 runs under DomLive, as an app does.
//
// EXPECTED says what each fixture's markup carries and how its element moves:
//   - `starting`: the server's style on `[data-k=startK]` (HY3);
//   - `startingAttrs`: the server's attributes there (F6's `draggable`, F8's SVG keys);
//   - `tracks`: numbers read on the client: at the first paint after hydration each is
//     at most a quarter of the way to its target (HY4: no flash), and it settles at it
//     (HY5);
//   - `texts`: readouts, `server` in the markup and the first paint, `settled` after.
import * as Renderer from "@wardic/core/Renderer"
import { DomLive, RendererDomLive } from "@wardic/dom"
import {
  AnimatePresence,
  createHover,
  createReducedMotion,
  streamToSignal,
  LayoutGroup,
  Reorder,
  useWardic,
  wardic,
  type WardicEnv,
  WardicProvider,
  type WardicTransition,
} from "@wardic/solid"
import { TestLive } from "@wardic/test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { createRenderEffect, For, type JSX, Show } from "solid-js"

const TWEEN: WardicTransition = { type: "tween", duration: 0.3 }

/** The DOM's projection (the server's, ADR-0021 decision 2), for the expected styles. */
const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), RendererDomLive)).project

/** `values` projected as the server writes it: every key a string. */
const projected = (values: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(domProject(values)).map(([k, v]) => [k, String(v)]))

const live = (ui: () => JSX.Element, env: WardicEnv = DomLive) => (): JSX.Element => (
  <WardicProvider env={env}>{ui()}</WardicProvider>
)

/** Props a wrapped component receives from wardic.create. */
interface ShapeProps {
  readonly ref?: (el: HTMLElement) => void
  readonly style?: JSX.CSSProperties
  readonly draggable?: "false" | "true"
  readonly children?: JSX.Element
}

const RefAndStyle = (p: ShapeProps): JSX.Element => (
  <div data-k="f3" ref={p.ref} style={p.style} draggable={p.draggable}>
    {p.children}
  </div>
)
const RefOnly = (p: ShapeProps): JSX.Element => (
  <div data-k="f4" ref={p.ref}>
    {p.children}
  </div>
)
const StyleInner = (p: ShapeProps): JSX.Element => (
  <div data-k="f5" ref={p.ref}>
    <span data-k="f5-inner" style={p.style}>
      {p.children}
    </span>
  </div>
)
const WRefAndStyle = wardic.create(RefAndStyle)
const WRefOnly = wardic.create(RefOnly)
const WStyleInner = wardic.create(StyleInner)

const VALUES = ["a", "b", "c"]

export const F0 = live(
  () => (
    <wardic.div data-k="f0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN}>
      f0
    </wardic.div>
  ),
  TestLive,
)

export const F1 = live(() => (
  <wardic.div data-k="f1" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={TWEEN}>
    f1
  </wardic.div>
))

function Spread(): JSX.Element {
  const ward = useWardic({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
  return (
    <section data-k="f2" {...ward()}>
      f2
    </section>
  )
}
export const F2 = live(() => <Spread />)

export const F3 = live(() => (
  <WRefAndStyle initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN}>
    f3
  </WRefAndStyle>
))

export const F4 = live(() => (
  <WRefOnly initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN}>
    f4
  </WRefOnly>
))

export const F5 = live(() => (
  <WStyleInner initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN}>
    f5
  </WStyleInner>
))

export const F6 = live(() => (
  <wardic.div data-k="f6" drag="x" initial={{ opacity: 0.5 }} animate={{ opacity: 1 }} transition={TWEEN}>
    f6
  </wardic.div>
))

export const F7 = live(() => (
  <Reorder.Group data-k="f7" values={VALUES} onReorder={() => {}}>
    <For each={VALUES}>{(value) => <Reorder.Item value={value}>{value}</Reorder.Item>}</For>
  </Reorder.Group>
))

export const F8 = live(() => (
  <svg width="100" height="20">
    <wardic.circle data-k="f8" r={5} cy={10} initial={{ cx: 10, opacity: 0.2 }} animate={{ cx: 40, opacity: 1 }} transition={TWEEN} />
  </svg>
))

export const F9 = live(() => (
  <AnimatePresence>
    <Show when={true}>
      <wardic.div data-k="f9" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={TWEEN}>
        f9
      </wardic.div>
    </Show>
  </AnimatePresence>
))

export const F10 = live(() => (
  <LayoutGroup>
    <wardic.div data-k="f10" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN}>
      f10
    </wardic.div>
  </LayoutGroup>
))

function ReducedMotion(): JSX.Element {
  const reduced = createReducedMotion()
  return (
    <p>
      <span data-k="rm">{String(reduced())}</span>
      <Show when={!reduced()}>
        <i data-k="motion-ok" />
      </Show>
    </p>
  )
}
export const F11 = live(() => <ReducedMotion />)

/** The readout runs inside its target, so the target's ref is set when createHover runs. */
function HoverReadout(props: { readonly target: () => HTMLElement | undefined }): JSX.Element {
  // On a server the ref is never set and nothing starts (ADR-0021, decision 8).
  const hovered = createHover(props.target())
  return <span data-k="hv">{String(hovered())}</span>
}
function Hover(): JSX.Element {
  let target: HTMLDivElement | undefined
  return (
    <div data-k="hover-target" ref={target}>
      hover me <HoverReadout target={() => target} />
    </div>
  )
}
export const F12 = live(() => <Hover />)

/**
 * What each render of HOLD_RM and HOLD_STREAM saw, in order (on the client; the server has
 * its own copy of this module). Tests reset it before rendering.
 */
export const seen: { readonly reduced: Array<boolean>; readonly stream: Array<string> } = { reduced: [], stream: [] }

function ReducedRecorder(): JSX.Element {
  const reduced = createReducedMotion()
  createRenderEffect(() => seen.reduced.push(reduced()))
  return (
    <p>
      <span data-k="rm2">{String(reduced())}</span>
      <Show when={!reduced()}>
        <i data-k="ok2" />
      </Show>
    </p>
  )
}
/** HY-H1: createReducedMotion, whose live value a test can make differ from the server's. */
export const HOLD_RM = live(() => <ReducedRecorder />)

function StreamRecorder(): JSX.Element {
  // A stream that emits at once: without the hold, a hydrating client would show "live"
  // in the hydration render, over the server's "server".
  const value = streamToSignal(Stream.succeed("live"), "server")
  createRenderEffect(() => seen.stream.push(value()))
  return <span data-k="st">{value()}</span>
}
/** HY-H2 and HY-H3: streamToSignal over a stream that emits at once. */
export const HOLD_STREAM = live(() => <StreamRecorder />)

/** The Environment the log fixture hydrates under (DomLive on the server; HY-L1 swaps it). */
let logEnv: WardicEnv = DomLive
/** Set the client Environment for {@link LOG} and {@link LOG_CARD}; HY-L1 to HY-L4 call it before rendering. */
export const setLogEnv = (env: WardicEnv): void => {
  logEnv = env
}
/** HY-L1 to HY-L3: a wardic.div whose Starting style a custom Renderer could change. */
export const LOG = (): JSX.Element => (
  <WardicProvider env={logEnv}>
    <wardic.div data-k="log" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={TWEEN}>
      log
    </wardic.div>
  </WardicProvider>
)

const LogCardShape = (p: ShapeProps): JSX.Element => (
  <div data-k="log-card" ref={p.ref} style={p.style}>
    {p.children}
  </div>
)
const WLogCard = wardic.create(LogCardShape)
/** HY-L4: LOG's twin for a component wrap (the commit sink's path). */
export const LOG_CARD = (): JSX.Element => (
  <WardicProvider env={logEnv}>
    <WLogCard initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={TWEEN}>
      log card
    </WLogCard>
  </WardicProvider>
)

/** A number the client reads, its server value and its target. */
export interface Track {
  readonly label: string
  readonly read: (host: HTMLElement) => number
  readonly from: number
  readonly to: number
}

/** A readout's text in the server markup and after mount. */
export interface Text {
  readonly k: string
  readonly server: string
  readonly settled: string
}

export interface Expected {
  readonly startK: string
  readonly starting: Readonly<Record<string, string>>
  readonly startingAttrs?: Readonly<Record<string, string>>
  readonly tracks: ReadonlyArray<Track>
  readonly texts?: ReadonlyArray<Text>
}

const el = (host: HTMLElement, k: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-k="${k}"]`)
/** The visible opacity: the computed opacities of `ks` multiplied. */
const opacity = (...ks: ReadonlyArray<string>) => (host: HTMLElement): number =>
  ks.reduce((acc, k) => {
    const node = el(host, k)
    return acc * (node === null ? 1 : Number(getComputedStyle(node).opacity))
  }, 1)
/** The painted uniform scale: the computed transform matrix's x-axis length, 1 for none. */
const scale = (k: string) => (host: HTMLElement): number => {
  const node = el(host, k)
  const t = node === null ? "none" : getComputedStyle(node).transform
  if (t === "" || t === "none") return 1
  const v = /\(([^)]+)\)/.exec(t)![1]!.split(",").map(Number)
  return Math.hypot(v[0]!, v[1]!)
}
/** The painted background's red channel, 0 to 1. */
const red = (k: string) => (host: HTMLElement): number => {
  const node = el(host, k)
  const c = node === null ? "" : getComputedStyle(node).backgroundColor
  const m = /\((\d+)/.exec(c)
  return m === null ? Number.NaN : Number(m[1]) / 255
}
const attr = (k: string, name: string) => (host: HTMLElement): number => Number(el(host, k)?.getAttribute(name) ?? NaN)

const DRAG_X = { "touch-action": "pan-y", "user-select": "none", "-webkit-user-select": "none", "-webkit-touch-callout": "none" }

// #47 (ADR-0022): a key no `initial` sets has no Starting style; the client starts it from its
// Own value after mount, so hydration shows no blink (F13), and a gesture-only key leaves the
// markup and the first paint alone (F14).
export const F13 = live(() => (
  <wardic.div data-k="f13" animate={{ opacity: 0.5 }} transition={TWEEN}>
    f13
  </wardic.div>
))

export const F14 = live(() => (
  <wardic.div data-k="f14" style={{ width: "40px" }} whileHover={{ scale: 1.5 }} whileTap={{ opacity: 0.5 }}>
    f14
  </wardic.div>
))

// #57 (ADR-0023, ADR-0021's amendment): an `initial` whose transform keys are all at their
// Identity server-renders `transform: none`, Motion's markup. The hydrating client holds it and
// animates from it (F15), or keeps it at rest (F16). Literal, not `projected`: the markup is
// the point.
export const F15 = live(() => (
  <wardic.div data-k="f15" initial={{ scale: 1 }} animate={{ scale: 1.2 }} transition={TWEEN}>
    f15
  </wardic.div>
))

export const F16 = live(() => (
  <wardic.div data-k="f16" initial={{ x: 0, scale: 1 }} whileHover={{ scale: 1.5 }}>
    f16
  </wardic.div>
))

// #56 (ADR-0024): a string `initial` server-renders as it is; the hydrating client holds it at the
// first paint, then animates from it rather than snapping to its target.
export const F17 = live(() => (
  <wardic.div data-k="f17" initial={{ "background-color": "#000" }} animate={{ "background-color": "#fff" }} transition={TWEEN}>
    f17
  </wardic.div>
))

// #50 (ADR-0007, ADR-0021's amendments): a Variant child with no `initial` of its own
// server-renders its `wardic.ul`'s `initial` name, the hydrating client holds it, and the list
// enters staggered from it.
const LIST = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
export const F18 = live(() => (
  <wardic.ul initial="hidden" animate="shown" variants={LIST} transition={{ ...TWEEN, staggerChildren: 0.05 }}>
    <wardic.li variants={LIST}>a</wardic.li>
    <wardic.li data-k="f18" variants={LIST}>
      b
    </wardic.li>
  </wardic.ul>
))

// #134: `initial={false}` starts at `animate`, in the markup and from the first paint, and
// nothing animates at mount: on an element (F19), a Variant child (F20) and the child of an
// `<AnimatePresence initial={false}>` with an `initial` of its own (F21).
export const F19 = live(() => (
  <wardic.div data-k="f19" initial={false} animate={{ opacity: 0.5 }} transition={TWEEN}>
    f19
  </wardic.div>
))
export const F20 = live(() => (
  <wardic.ul initial={false} animate="shown" variants={LIST} transition={{ ...TWEEN, staggerChildren: 0.05 }}>
    <wardic.li variants={LIST}>a</wardic.li>
    <wardic.li data-k="f20" variants={LIST}>
      b
    </wardic.li>
  </wardic.ul>
))
export const F21 = live(() => (
  <AnimatePresence initial={false}>
    <wardic.div data-k="f21" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={TWEEN}>
      f21
    </wardic.div>
  </AnimatePresence>
))

export const FIXTURES = { F0, F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20, F21 } as const
export type FixtureName = keyof typeof FIXTURES

export const EXPECTED: Readonly<Record<FixtureName, Expected>> = {
  // TestLive's Clock never ticks in a browser, so F0 holds its Starting style (a control).
  F0: { startK: "f0", starting: projected({ opacity: 0 }), tracks: [{ label: "opacity", read: opacity("f0"), from: 0, to: 0 }] },
  F1: { startK: "f1", starting: projected({ opacity: 0, x: 10 }), tracks: [{ label: "opacity", read: opacity("f1"), from: 0, to: 1 }] },
  F2: { startK: "f2", starting: projected({ opacity: 0 }), tracks: [{ label: "opacity", read: opacity("f2"), from: 0, to: 1 }] },
  F3: { startK: "f3", starting: projected({ opacity: 0 }), tracks: [{ label: "opacity", read: opacity("f3"), from: 0, to: 1 }] },
  // A component that applies no style has no server Starting style (decision 6).
  F4: { startK: "f4", starting: {}, tracks: [{ label: "opacity", read: opacity("f4"), from: 0, to: 1 }] },
  F5: {
    startK: "f5-inner",
    starting: projected({ opacity: 0 }),
    tracks: [{ label: "visible opacity", read: opacity("f5", "f5-inner"), from: 0, to: 1 }],
  },
  F6: {
    startK: "f6",
    starting: { ...projected({ opacity: 0.5 }), ...DRAG_X },
    startingAttrs: { draggable: "false" },
    tracks: [{ label: "opacity", read: opacity("f6"), from: 0.5, to: 1 }],
  },
  F7: { startK: "f7", starting: { "overflow-anchor": "none" }, tracks: [] },
  F8: {
    startK: "f8",
    starting: {},
    startingAttrs: { cx: "10", opacity: "0.2" },
    tracks: [
      { label: "cx", read: attr("f8", "cx"), from: 10, to: 40 },
      { label: "opacity", read: opacity("f8"), from: 0.2, to: 1 },
    ],
  },
  F9: { startK: "f9", starting: projected({ opacity: 0 }), tracks: [{ label: "opacity", read: opacity("f9"), from: 0, to: 1 }] },
  F10: { startK: "f10", starting: projected({ opacity: 0 }), tracks: [{ label: "opacity", read: opacity("f10"), from: 0, to: 1 }] },
  F11: { startK: "rm", starting: {}, tracks: [], texts: [{ k: "rm", server: "false", settled: "false" }] },
  F12: { startK: "hv", starting: {}, tracks: [], texts: [{ k: "hv", server: "false", settled: "false" }] },
  // An `animate`-only key: no Starting style, and the first paint after hydration keeps the
  // element's own opacity (1) on its way to 0.5: no blink to 0, no jump to the target.
  F13: { startK: "f13", starting: {}, tracks: [{ label: "opacity", read: opacity("f13"), from: 1, to: 0.5 }] },
  // A gesture-only key: the markup and the painted scale are untouched until a gesture.
  F14: { startK: "f14", starting: { width: "40px" }, tracks: [{ label: "scale", read: scale("f14"), from: 1, to: 1 }] },
  // An identity `initial`: `none` in the markup, held at the first paint, then animated from 1.
  F15: { startK: "f15", starting: { transform: "none" }, tracks: [{ label: "scale", read: scale("f15"), from: 1, to: 1.2 }] },
  // An identity `initial` at rest: `none` in the markup, at the first paint and after mount.
  F16: { startK: "f16", starting: { transform: "none" }, tracks: [] },
  // A string `initial`: in the markup, held at the first paint, then animated (not snapped) to white.
  F17: { startK: "f17", starting: projected({ "background-color": "#000" }), tracks: [{ label: "red", read: red("f17"), from: 0, to: 1 }] },
  // #50: a Variant child's Starting style is its ancestor's `initial` name.
  F18: { startK: "f18", starting: projected({ opacity: 0 }), tracks: [{ label: "opacity", read: opacity("f18"), from: 0, to: 1 }] },
  // #134: at its `animate` in the markup, at the first paint and after: no motion at all.
  F19: { startK: "f19", starting: projected({ opacity: 0.5 }), tracks: [{ label: "opacity", read: opacity("f19"), from: 0.5, to: 0.5 }] },
  F20: { startK: "f20", starting: projected({ opacity: 1 }), tracks: [{ label: "opacity", read: opacity("f20"), from: 1, to: 1 }] },
  F21: { startK: "f21", starting: projected({ opacity: 0.5 }), tracks: [{ label: "opacity", read: opacity("f21"), from: 0.5, to: 0.5 }] },
}
