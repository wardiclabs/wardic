// #443's hooks and exports on Solid 1, on a server and as plain functions.
//
// - SUS1: `isValidWardicProp`: Solid 1's motion props, exactly; not Motion's prefixes.
// - SUS2: `isWardicComponent` / `unwrapWardicComponent`: a `wardic.<tag>` and a `wardic.create`
//   component, marked with what they wrap; anything else isn't.
// - SUS3: `type: "svg"`: a wrapped component's attribute keys render as attributes, as `wardic.circle`'s;
//   without it, as style; `type: "html"` renders a circle's as style.
// - SUS4: `WardicConfig`'s `isValidProp` keeps a tag's props off it on a server too, as on the client.
// - SUS5: on a server, `createPageInView` is `true`; `createReducedMotionConfig` is `true` for
//   `"always"` and `false` for the rest; `createAnimationFrame` calls nothing.
// - SUS6: `forwardMotionProps` hands a wrapped component the motion props on a server too.
import {
  createAnimationFrame,
  createPageInView,
  createReducedMotionConfig,
  isValidWardicProp,
  isWardicComponent,
  unwrapWardicComponent,
  wardic,
  WardicConfig,
  WardicProvider,
} from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import type { Component, JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr-helpers.ts"

type Wrappable = { readonly ref?: (el: HTMLElement) => void; readonly style?: JSX.CSSProperties }

describe("isValidWardicProp (#443, Motion's isValidMotionProp)", () => {
  it("SUS1: Solid 1's motion props, exactly", () => {
    for (const key of ["animate", "initial", "whileHover", "layoutCrossfade", "dragControls", "onTap", "onAnimationStart", "onUpdate", "transition", "key"]) {
      expect(isValidWardicProp(key), key).toBe(true)
    }
    for (const key of ["href", "class", "style", "ref", "whileAnything", "dragFoo", "draggable", "onClick", "layoutFoo"]) {
      expect(isValidWardicProp(key), key).toBe(false)
    }
  })
})

describe("isWardicComponent and unwrapWardicComponent (#443, Motion's)", () => {
  it("SUS2: wardic.<tag> and wardic.create components, marked with what they wrap; anything else isn't", () => {
    const Box: Component<Wrappable> = (props) => <div ref={props.ref} />
    const WardicBox = wardic.create(Box)
    expect(isWardicComponent(wardic.div)).toBe(true)
    expect(unwrapWardicComponent(wardic.div)).toBe("div")
    expect(isWardicComponent(WardicBox)).toBe(true)
    expect(unwrapWardicComponent(WardicBox)).toBe(Box)
    expect(unwrapWardicComponent(wardic.create("span", { forwardMotionProps: true }))).toBe("span")
    for (const other of [Box, "div", null, undefined, {}, () => null]) {
      expect(isWardicComponent(other)).toBe(false)
      expect(unwrapWardicComponent(other)).toBeUndefined()
    }
  })
})

describe("wardic.create's type (#443, Motion's)", () => {
  it("SUS3: \"svg\" renders a wrapped component's attribute keys as attributes; without it, as style; \"html\" a circle's as style", () => {
    // Its ref is an SVG element's: Solid 1's wrapped component types it as an HTML element's.
    const Dot: Component<Wrappable & Record<string, unknown>> = (props) => <circle {...(props as unknown as JSX.CircleSVGAttributes<SVGCircleElement>)} />
    const SvgDot = wardic.create(Dot, { type: "svg" })
    const HtmlDot = wardic.create(Dot)
    const HtmlCircle = wardic.create("circle", { type: "html" })
    const [, svg, html, circle] = tagsOf(
      serve(() => (
        <svg>
          <SvgDot initial={{ cx: 10, opacity: 0.5 }} />
          <HtmlDot initial={{ opacity: 0.5 }} />
          <HtmlCircle initial={{ opacity: 0.5 }} />
        </svg>
      )),
    )
    expect(svg?.attrs.cx).toBe("10")
    expect(svg?.attrs.opacity).toBe("0.5")
    expect(svg?.style.opacity).toBeUndefined()
    expect(html?.attrs.opacity).toBeUndefined()
    expect(html?.style.opacity).toBe("0.5")
    expect(circle?.attrs.opacity).toBeUndefined()
    expect(circle?.style.opacity).toBe("0.5")
  })
})

describe("WardicConfig's isValidProp on a server (#443)", () => {
  it("SUS4: a tag's props it says aren't valid stay off, as on the client", () => {
    const props = { tone: "danger" } as Record<string, unknown>
    const [div] = tagsOf(
      serve(() => (
        <WardicConfig isValidProp={(key) => key !== "tone"}>
          <wardic.div {...props} title="t" initial={{ opacity: 0 }} />
        </WardicConfig>
      )),
    )
    expect(div?.attrs.tone).toBeUndefined()
    expect(div?.attrs.title).toBe("t")
    expect(div?.style.opacity).toBe("0")
  })
})

describe("the hooks on a server (#443)", () => {
  it("SUS5: createPageInView true; createReducedMotionConfig true for always, false else; createAnimationFrame calls nothing", () => {
    let frames = 0
    const Read = (props: { readonly name: string }): JSX.Element => {
      const visible = createPageInView()
      const applies = createReducedMotionConfig()
      createAnimationFrame(() => void frames++)
      return <p data-name={props.name} data-visible={String(visible())}>{String(applies())}</p>
    }
    const html = serve(() => (
      <WardicProvider env={DomLive} reducedMotion="always">
        <Read name="provider" />
        <WardicConfig reducedMotion="never">
          <Read name="never" />
        </WardicConfig>
        <WardicConfig reducedMotion="user">
          <Read name="user" />
        </WardicConfig>
      </WardicProvider>
    ))
    const ps = tagsOf(html).filter((t) => t.name === "p")
    expect(ps.map((p) => p.attrs["data-visible"])).toEqual(["true", "true", "true"])
    expect(html).toMatch(/data-name="provider"[^>]*>true</)
    expect(html).toMatch(/data-name="never"[^>]*>false</)
    expect(html).toMatch(/data-name="user"[^>]*>false</)
    expect(frames).toBe(0)
  })

  it("SUS6: forwardMotionProps hands a wrapped component the motion props on a server too", () => {
    let seen: unknown
    const Box: Component<Wrappable & { readonly animate?: unknown }> = (props) => {
      seen = props.animate
      return <div ref={props.ref} style={props.style} />
    }
    const Forwarding = wardic.create(Box, { forwardMotionProps: true })
    serve(() => <Forwarding animate={{ opacity: 0.5 }} />)
    expect(seen).toEqual({ opacity: 0.5 })
  })
})
