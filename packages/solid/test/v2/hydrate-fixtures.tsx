// Fixtures for the Solid 2 binding's hydration tests (#209 PR 4a): each export is rendered on the
// server (Node) by the v2-hydrate project's commands and hydrated in Chromium from this one module.
// Appear animations' A1–A8 are the Solid 1 binding's (`../appear-fixtures.tsx`) on Solid 2. Each
// element to watch carries `data-k`. Not a test file itself.
import { DomLive } from "@wardic/dom"
import { wardic, type WardicEnv, WardicProvider } from "@wardic/solid/unstable/v2"
import { type JSX, Loading } from "@solidjs/web"
import { createSignal, For } from "solid-js"

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
      transition={{ type: "tween", duration: 0.8, repeat: Number.POSITIVE_INFINITY }}
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
