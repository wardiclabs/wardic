// Fixtures for the Solid 2 binding's hydration tests (#209 PR 4a): each export is rendered on the
// server (Node) by the v2-hydrate project's commands and hydrated in Chromium from this one module.
// Appear animations' A1–A8 are the Solid 1 binding's (`../appear-fixtures.tsx`) on Solid 2. Each
// element to watch carries `data-k`. Not a test file itself.
import * as Easing from "@wardic/core/Easing"
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  createDrag,
  createPresence,
  createFocus,
  createHover,
  createInView,
  createPress,
  createReducedMotion,
  createScroll,
  createSpring,
  createTime,
  createTransform,
  createVelocity,
  fromAtom,
  LayoutGroup,
  Reorder,
  reorderGroup,
  reorderItem,
  streamToSignal,
  useAnimateLayout,
  useWardicFiber,
  ward,
  wardic,
  WardicConfig,
  type WardicEnv,
  WardicProvider,
} from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as UndefinedOr from "effect/UndefinedOr"
import { Atom } from "effect/reactivity"
import { type Component, createEffect, createMemo, createSignal, For, Loading, Reveal, Show } from "solid-js"

/** The Environment the fixtures hydrate under: DomLive, or AH11's with a logger (the server's is DomLive). */
let env: WardicEnv = DomLive
/** Set the client Environment the fixtures hydrate under; reset it after. */
export const setAppearEnv = (next: WardicEnv): void => {
  env = next
}

const page = (children: () => JSX.Element): JSX.Element => <WardicProvider env={env}>{children()}</WardicProvider>

/** A card rising in on the default spring. */
export const A1 = (): JSX.Element => page(() => <wardic.div data-k="card" style={{ width: "40px", height: "40px" }} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} />)

/** A list whose items stagger in by 0.12 s, on a tween. */
export const A2 = (): JSX.Element => {
  const variants = { hidden: { opacity: 0, x: -30 }, shown: { opacity: 1, x: 0 } }
  return page(() => (
    <wardic.ul initial="hidden" animate="shown" variants={{ hidden: {}, shown: {} }} transition={{ type: "tween", duration: 0.5, staggerChildren: 0.12 }}>
      <wardic.li data-k="i0" variants={variants} style={{ height: "10px" }} />
      <wardic.li data-k="i1" variants={variants} style={{ height: "10px" }} />
      <wardic.li data-k="i2" variants={variants} style={{ height: "10px" }} />
    </wardic.ul>
  ))
}

/** A slow tween, long enough for a hydration in the middle of it. */
export const A3 = (): JSX.Element =>
  page(() => (
    <wardic.div
      data-k="slow"
      style={{ width: "40px", height: "40px" }}
      initial={{ opacity: 0, x: 0 }}
      animate={{ opacity: 1, x: 200 }}
      transition={{ type: "tween", duration: 1.2 }}
    />
  ))

/** A parent that fades in before its child rises (`when: "beforeChildren"`). */
export const A4 = (): JSX.Element => {
  const child = { hidden: { opacity: 0, y: 20 }, shown: { opacity: 1, y: 0 } }
  return page(() => (
    <wardic.section
      data-k="parent"
      initial="hidden"
      animate="shown"
      variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
      transition={{ type: "tween", duration: 0.3, when: "beforeChildren" }}
    >
      <wardic.p data-k="child" variants={child} transition={{ type: "tween", duration: 0.4 }} style={{ height: "10px" }} />
    </wardic.section>
  ))
}

/** A spinner that loops for ever. */
export const A5 = (): JSX.Element =>
  page(() => (
    <wardic.div
      data-k="spin"
      style={{ width: "20px", height: "20px" }}
      initial={{ rotate: 0 }}
      animate={{ rotate: 360 }}
      transition={{ type: "tween", duration: 0.8, repeat: Number.POSITIVE_INFINITY, ease: Easing.linear }}
    />
  ))

/** An SVG circle growing across and fading in, and a line drawing itself (#245): attributes, played as CSS. */
export const A6 = (): JSX.Element =>
  page(() => (
    <svg width="120" height="60">
      <wardic.circle
        data-k="dot"
        fill="teal"
        initial={{ cx: 10, r: 4, opacity: 0 }}
        animate={{ cx: 90, r: 16, opacity: 1 }}
        transition={{ type: "tween", duration: 1.2 }}
      />
      <wardic.path data-k="line" d="M0 50L120 50" stroke="black" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ type: "tween", duration: 1.2 }} />
    </svg>
  ))

/**
 * A layout card entering with scale, opacity and its own y (#245): the y isn't drawn on a layout
 * node (ADR-0016). `__a7grow()` grows the spacer above it, a layout change it animates.
 */
export const A7 = (): JSX.Element => {
  const [grown, setGrown] = createSignal(false)
  ;(globalThis as { __a7grow?: () => void }).__a7grow = () => setGrown(true)
  return page(() => (
    <div style={{ position: "relative", "padding-top": "10px" }}>
      <div style={{ height: `${Number(grown()) * 60}px` }} />
      <wardic.div
        data-k="card"
        layout
        layoutDependency={grown()}
        style={{ width: "40px", height: "40px", background: "teal" }}
        initial={{ opacity: 0, scale: 0.5, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "tween", duration: 1.2 }}
      />
    </div>
  ))
}

/**
 * A list its shell leads, its items streamed in a late `<Loading>` chunk (#245): staggered by
 * 0.12 s on a tween. The items are made by the data, so made late. `__a8add()` adds an item, a list
 * update after hydration.
 */
export const A8 = (): JSX.Element => {
  const items = { hidden: { opacity: 0, x: -30 }, shown: { opacity: 1, x: 0 } }
  const [data, setData] = createSignal(async (): Promise<ReadonlyArray<number>> => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    return [0, 1, 2]
  })
  ;(globalThis as { __a8add?: () => void }).__a8add = () => void setData((list) => [...list, list.length])
  return page(() => (
    <wardic.ul
      data-k="list"
      initial="hidden"
      animate="shown"
      variants={{ hidden: {}, shown: {} }}
      transition={{ type: "tween", duration: 0.5, staggerChildren: 0.12 }}
    >
      <Loading fallback={<li>loading</li>}>
        <For each={data()}>{(i) => <wardic.li data-k={`s${i}`} variants={items} style={{ height: "10px" }} />}</For>
      </Loading>
    </wardic.ul>
  ))
}

/**
 * A heading on a tag no other fixture uses (`hgroup`), so its `wardic.<tag>` component is made the
 * first time this fixture renders on each side, inside the render (WH1).
 */
export const W1 = (): JSX.Element =>
  page(() => (
    <main>
      <wardic.hgroup data-k="w" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        first use
      </wardic.hgroup>
      <wardic.p data-k="after">after it</wardic.p>
    </main>
  ))

/** W1 on a tag of its own (`address`), for a client that made its component before hydrating (WH2). */
export const W2 = (): JSX.Element =>
  page(() => (
    <main>
      <wardic.address data-k="w" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        first use
      </wardic.address>
      <wardic.p data-k="after">after it</wardic.p>
    </main>
  ))

/**
 * Every v2 helper and component with a server branch, one a fixture (KH): it, then `After`, a
 * component of its own, so its element's hydration key follows the ids the helper took. A helper
 * taking an id on one side only moves it, and hydration misses the server's `after`.
 */
const keyed = (Helper: Component): JSX.Element =>
  page(() => (
    <main>
      <Helper />
      <After />
    </main>
  ))
const After = (): JSX.Element => <p data-k="after">after</p>

/** Sensors on an element, and the reduced-motion preference. */
export const KSensors = (): JSX.Element =>
  keyed(() => {
    const hover = createHover()
    const press = createPress()
    const focus = createFocus()
    const inView = createInView()
    const drag = createDrag()
    const reduced = createReducedMotion()
    return (
      <div ref={[hover, press, focus, inView, drag]}>
        {String(hover())} {String(press())} {String(focus())} {String(inView())} {String(drag() === null)} {String(reduced())}
      </div>
    )
  })

/** `createTransform` on a signal and on a ward's `read`. */
export const KTransform = (): JSX.Element =>
  keyed(() => {
    const n = (): number => 1
    const doubled = createTransform(n, (v: number) => v * 2)
    const card = ward({ initial: { x: 0 }, animate: { x: 0 } })
    const fade = createTransform(card.read("x"), [0, 10], [1, 0])
    return (
      <div {...card}>
        {doubled()} {fade()}
      </div>
    )
  })

/** `createSpring`, `createVelocity` and `createTime`. */
export const KSpring = (): JSX.Element =>
  keyed(() => {
    const n = (): number => 1
    const spring = createSpring(n)
    const velocity = createVelocity(n)
    const time = createTime()
    return (
      <span>
        {Math.round(spring())} {Math.round(velocity())} {String(time() >= 0)}
      </span>
    )
  })

/** `createScroll`. */
export const KScroll = (): JSX.Element =>
  keyed(() => {
    const { scrollY } = createScroll()
    return <span>{String(scrollY() >= 0)}</span>
  })

/** `fromAtom` with a server value, and `streamToSignal`. */
export const KAtom = (): JSX.Element =>
  keyed(() => {
    const count = fromAtom(Atom.make(3), { serverValue: 3 })
    const streamed = streamToSignal(Stream.make(1), 1)
    return (
      <span>
        {count()} {streamed()}
      </span>
    )
  })

/** `useWardicFiber`. */
export const KFiber = (): JSX.Element =>
  keyed(() => {
    useWardicFiber(() => Effect.void)
    return <span>fiber</span>
  })

/** `<LayoutGroup>` around a layout element, and `useAnimateLayout`. */
export const KLayout = (): JSX.Element =>
  keyed(() => {
    useAnimateLayout()
    return (
      <LayoutGroup>
        <wardic.div layout style={{ width: "40px", height: "10px" }} />
      </LayoutGroup>
    )
  })

/** `<AnimatePresence>` around a shown child, and with `initial={false}`. */
export const KPresence = (): JSX.Element =>
  keyed(() => (
    <>
      <AnimatePresence>
        <Show when={true}>
          <wardic.div exit={{ opacity: 0 }}>in</wardic.div>
        </Show>
      </AnimatePresence>
      <AnimatePresence initial={false}>
        <Show when={true}>
          <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            held
          </wardic.div>
        </Show>
      </AnimatePresence>
    </>
  ))

/** `Reorder.Group` and `Reorder.Item`. */
export const KReorder = (): JSX.Element =>
  keyed(() => {
    const [items, setItems] = createSignal(["a", "b"])
    return (
      <Reorder.Group values={items()} onReorder={setItems}>
        <For each={items()}>{(value) => <Reorder.Item value={value}>{value}</Reorder.Item>}</For>
      </Reorder.Group>
    )
  })

/** `reorderGroup` and `reorderItem`. */
export const KReorderFactories = (): JSX.Element =>
  keyed(() => {
    const [items, setItems] = createSignal(["a", "b"])
    const list = reorderGroup({ values: items, onReorder: setItems })
    return (
      <ul {...list}>
        <For each={items()}>
          {(value) => {
            const row = reorderItem(list, { value })
            return <li {...row}>{value}</li>
          }}
        </For>
      </ul>
    )
  })

/** A kept ward spread, one given to `ref`, `read(key)`, and its `Provider` around a Variant child. */
export const KWard = (): JSX.Element =>
  keyed(() => {
    const card = ward({ initial: "a", animate: "b", variants: { a: { x: 0 }, b: { x: 0 } } })
    const plain = ward({ animate: { opacity: 1 } })
    const x = card.read("x")
    return (
      <div {...card}>
        <card.Provider>
          <wardic.span variants={{ a: { opacity: 1 }, b: { opacity: 1 } }}>{x()}</wardic.span>
        </card.Provider>
        <p ref={plain}>ref</p>
      </div>
    )
  })

const Wrapped = (props: { readonly ref?: JSX.Ref<HTMLDivElement> }): JSX.Element => <div ref={props.ref}>wrapped</div>
const WardicWrapped = wardic.create(Wrapped)

/** `wardic.create(Component)`. */
export const KCreate = (): JSX.Element => keyed(() => <WardicWrapped animate={{ opacity: 1 }} />)

/** `when(name)` (#355) on a ward, a Reorder group and a presence handle, each in an effect. */
export const KWhen = (): JSX.Element =>
  keyed(() => {
    const card = ward({ drag: "x" })
    const [items, setItems] = createSignal(["a", "b"])
    const list = reorderGroup({ values: items, onReorder: setItems })
    const presence = createPresence()
    createEffect(card.when("dragEnd"), () => {})
    createEffect(list.when("reorderEnd"), () => {})
    createEffect(presence.when("exitComplete"), () => {})
    return (
      <>
        <div {...card}>card</div>
        <ul {...list} />
        <AnimatePresence ref={presence}>
          <Show when={true}>
            <wardic.p exit={{ opacity: 0 }}>in</wardic.p>
          </Show>
        </AnimatePresence>
      </>
    )
  })

/**
 * Wards given to `wardRef` (#349): on `wardic.*` with a child made with its `parent`, on
 * `wardic.create`, under a presence, and a group and its items given to `Reorder`'s components.
 */
export const KGiven = (): JSX.Element =>
  keyed(() => {
    const VARIANTS = { a: { opacity: 0.5 }, b: { opacity: 1 } }
    const list = ward({ initial: "a", animate: "b", variants: VARIANTS })
    const row = ward({ variants: VARIANTS }, { parent: list })
    const wrapped = ward({ animate: { opacity: 1 } })
    const toast = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })
    const [items, setItems] = createSignal(["a", "b"])
    const group = reorderGroup({ values: items, onReorder: setItems })
    return (
      <>
        <wardic.ul wardRef={list}>
          <wardic.li wardRef={row}>row</wardic.li>
        </wardic.ul>
        <WardicWrapped wardRef={wrapped} />
        <AnimatePresence>
          <Show when={true}>
            <wardic.div wardRef={toast}>toast</wardic.div>
          </Show>
        </AnimatePresence>
        <Reorder.Group groupRef={group}>
          <For each={items()}>
            {(value) => {
              const item = reorderItem(group, { value })
              return <Reorder.Item wardRef={item}>{value}</Reorder.Item>
            }}
          </For>
        </Reorder.Group>
      </>
    )
  })

/**
 * Listening wards given to `wardRef` (#398): the element's motion props beside them, a Variant child
 * building its own node in the parent it renders in, one made with a `parent`, and a given group and
 * item with their element props.
 */
export const KListening = (): JSX.Element =>
  keyed(() => {
    const VARIANTS = { a: { opacity: 0.5 }, b: { opacity: 1 } }
    const card = ward()
    const row = ward()
    const list = ward({ initial: "a", animate: "b", variants: VARIANTS })
    const tip = ward(undefined, { parent: list })
    const [items, setItems] = createSignal(["a", "b"])
    const group = reorderGroup({ values: items, onReorder: setItems })
    return (
      <>
        <wardic.div wardRef={card} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ width: "10px" }}>card</wardic.div>
        <wardic.ul initial="a" animate="b" variants={VARIANTS}>
          <wardic.li wardRef={row} variants={VARIANTS}>row</wardic.li>
        </wardic.ul>
        <wardic.ul wardRef={list} />
        <wardic.p wardRef={tip} variants={VARIANTS}>tip</wardic.p>
        <Reorder.Group groupRef={group} axis="y">
          <For each={items()}>
            {(value) => {
              const item = reorderItem(group, { value })
              return <Reorder.Item wardRef={item} initial={{ opacity: 0.5 }} animate={{ opacity: 1 }}>{value}</Reorder.Item>
            }}
          </For>
        </Reorder.Group>
      </>
    )
  })

/** Two regions under `<Reveal>` (#257 item 13, AH13): the second's data first, an Appear element in it. */
export const A9 = (): JSX.Element => {
  const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))
  const slow = createMemo(() => later(300, "slow"))
  const fast = createMemo(() => later(30, "fast"))
  return page(() => (
    <Reveal>
      <Loading fallback={<p data-k="fb1">first loading</p>}>
        <p data-k="slow">{slow()}</p>
      </Loading>
      <Loading fallback={<p data-k="fb2">second loading</p>}>
        <p>{fast()}</p>
        <wardic.div data-k="fast" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: "tween", duration: 0.5 }} style={{ width: "40px", height: "40px" }} />
      </Loading>
    </Reveal>
  ))
}

/** What HE1–HE2's card heard: each release's `offset.x` through the memo, or `undefined`. */
export const heard: Array<number | undefined> = []

/**
 * A card whose releases are read as an async value (#343): a memo over `card.each("dragEnd")` with
 * `options`, and an effect. Made under a `<Loading>`, and streamed from a server, whose `each` ends
 * at once.
 */
const releasedWith = (options: { readonly ssrSource?: "client" }) => (): JSX.Element => {
  const card = ward({ drag: "x" })
  const released = createMemo(() => card.each("dragEnd"), options)
  createEffect(released, (release) => {
    heard.push(UndefinedOr.map(release, (r) => r.offset.x))
  })
  return <div data-k="card" {...card} style={{ width: "80px", height: "40px", background: "#8af" }} />
}
const ReleasedInBrowser = releasedWith({ ssrSource: "client" })
const ReleasedPlain = releasedWith({})

/** HE1: the README's form, `ssrSource: "client"`. */
export const HE1 = (): JSX.Element =>
  page(() => (
    <Loading fallback={<p>loading</p>}>
      <ReleasedInBrowser />
    </Loading>
  ))

/** HE3 (#355): `card.when("dragEnd")` in an effect, under no `<Loading>`. */
export const HE3 = (): JSX.Element =>
  page(() => {
    const card = ward({ drag: "x" })
    createEffect(card.when("dragEnd"), (release) => {
      heard.push(release.offset.x)
    })
    return <div data-k="card" {...card} style={{ width: "80px", height: "40px", background: "#8af" }} />
  })

/** HE2: a plain memo over `each`. */
export const HE2 = (): JSX.Element =>
  page(() => (
    <Loading fallback={<p>loading</p>}>
      <ReleasedPlain />
    </Loading>
  ))

/** A ward's card and a staggered list under a `WardicConfig`'s `skipAnimations` (#468): drawn landed from first paint. */
export const A10 = (): JSX.Element => {
  const variants = { hidden: { opacity: 0, x: -30 }, shown: { opacity: 1, x: 0 } }
  const Card = (): JSX.Element => {
    const card = ward({ initial: { opacity: 0, y: 40 }, animate: { opacity: 1, y: 0 }, transition: { type: "tween", duration: 1.5 }, style: { width: "40px", height: "40px" } })
    return <div data-k="card" {...card} />
  }
  return page(() => (
    <WardicConfig skipAnimations>
      <Card />
      <wardic.ul initial="hidden" animate="shown" variants={{ hidden: {}, shown: {} }} transition={{ type: "tween", duration: 0.5, staggerChildren: 0.3 }}>
        <wardic.li data-k="i0" variants={variants} style={{ height: "10px" }} />
        <wardic.li data-k="i1" variants={variants} style={{ height: "10px" }} />
      </wardic.ul>
    </WardicConfig>
  ))
}

