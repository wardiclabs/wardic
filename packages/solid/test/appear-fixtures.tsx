// Appear animation fixtures (#48, ADR-0044): rendered on the server in Node by the hydrate
// project's `serverRenderPage` command, and hydrated in Chromium by appear.hydrate.browser.test.tsx.
// Each element to watch carries `data-k`.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import type { JSX } from "solid-js"

const page = (children: () => JSX.Element): JSX.Element => <WardicProvider env={DomLive}>{children()}</WardicProvider>

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
