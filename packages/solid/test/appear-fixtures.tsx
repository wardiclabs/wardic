// Appear animation fixtures (#48, ADR-0044): rendered on the server in Node by the hydrate
// project's `serverRenderPage` command, and hydrated in Chromium by appear.hydrate.browser.test.tsx.
// Each element to watch carries `data-k`.
import * as Easing from "@wardic/core/Easing"
import { DomLive } from "@wardic/dom"
import { wardic, WardicConfig, type WardicEnv, WardicProvider } from "@wardic/solid"
import { createResource, createSignal, For, type JSX, Suspense } from "solid-js"

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

/** A tween beside a key already at its target (#448): the rule moves `x` alone, `opacity` held at its 0.5. */
export const A9 = (): JSX.Element =>
  page(() => (
    <wardic.div
      data-k="half"
      style={{ width: "40px", height: "40px" }}
      initial={{ opacity: 0.5, x: 0 }}
      animate={{ opacity: 0.5, x: 200 }}
      transition={{ type: "tween", duration: 1.2 }}
    />
  ))

/** Keyframes (#429): a first `null` stop from `initial`, through 200, to 80. */
export const A10 = (): JSX.Element =>
  page(() => (
    <wardic.div
      data-k="stops"
      style={{ width: "40px", height: "40px" }}
      initial={{ x: 0 }}
      animate={{ x: [null, 200, 80] }}
      transition={{ type: "tween", duration: 1.2, ease: "linear" }}
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
 * A list its shell leads, its items streamed in a late `Suspense` chunk (#245): staggered by 0.12 s
 * on a tween. `__a8add()` adds an item, a list update after hydration.
 */
export const A8 = (): JSX.Element => {
  const items = { hidden: { opacity: 0, x: -30 }, shown: { opacity: 1, x: 0 } }
  const [data, { mutate }] = createResource(() => new Promise<Array<number>>((resolve) => setTimeout(() => resolve([0, 1, 2]), 30)))
  ;(globalThis as { __a8add?: () => void }).__a8add = () => void mutate((list) => [...(list ?? []), (list ?? []).length])
  return page(() => (
    <wardic.ul
      data-k="list"
      initial="hidden"
      animate="shown"
      variants={{ hidden: {}, shown: {} }}
      transition={{ type: "tween", duration: 0.5, staggerChildren: 0.12 }}
    >
      <Suspense fallback={<li>loading</li>}>
        <For each={data()}>{(i) => <wardic.li data-k={`s${i}`} variants={items} style={{ height: "10px" }} />}</For>
      </Suspense>
    </wardic.ul>
  ))
}

/**
 * A card and a staggered list under a `WardicConfig`'s `skipAnimations` (#468): drawn landed from
 * first paint. Each mount's start and complete pushed to `__a11told` on the client.
 */
export const A11 = (): JSX.Element => {
  const told = ((globalThis as { __a11told?: Array<string> }).__a11told ??= [])
  const tell = (name: string) => () => void told.push(name)
  const variants = { hidden: { opacity: 0, x: -30 }, shown: { opacity: 1, x: 0 } }
  return page(() => (
    <WardicConfig skipAnimations>
      <wardic.div
        data-k="card"
        style={{ width: "40px", height: "40px" }}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "tween", duration: 1.5 }}
        onAnimationStart={tell("start")}
        onAnimationComplete={tell("complete")}
      />
      <wardic.ul initial="hidden" animate="shown" variants={{ hidden: {}, shown: {} }} transition={{ type: "tween", duration: 0.5, staggerChildren: 0.3 }}>
        <wardic.li data-k="i0" variants={variants} style={{ height: "10px" }} />
        <wardic.li data-k="i1" variants={variants} style={{ height: "10px" }} />
      </wardic.ul>
    </WardicConfig>
  ))
}

