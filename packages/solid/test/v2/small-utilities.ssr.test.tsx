// #443's hooks and exports on Solid 2, on a server and as plain functions, as Solid 1's SUS tests.
//
// - SUSV1: `isValidWardicProp`: Solid 2's motion props, which leave out the callbacks that are DOM
//   events there.
// - SUSV2: `isWardicComponent` / `unwrapWardicComponent`, Solid 2's components marked as Solid 1's.
// - SUSV3: `type: "svg"`: a wrapped component's attribute keys render as attributes; without it, as style.
// - SUSV4: `WardicConfig`'s `isValidProp` keeps a tag's props off it on a server too.
// - SUSV5: on a server, `createPageInView` is `true`, `createReducedMotionConfig` `true` for
//   `"always"`, and `createAnimationFrame` calls nothing.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
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
} from "@wardic/solid/unstable/v2"
import { describe, expect, it } from "vitest"
import { serve, tagsOf } from "./ssr.ts"

describe("#443's exports on Solid 2", () => {
  it("SUSV1: isValidWardicProp: Solid 2's motion props, without the callbacks that are DOM events there", () => {
    for (const key of ["animate", "whileHover", "layoutCrossfade", "onUpdate", "transition"]) expect(isValidWardicProp(key), key).toBe(true)
    for (const key of ["onAnimationStart", "onTap", "onDrag", "href", "whileAnything"]) expect(isValidWardicProp(key), key).toBe(false)
  })

  it("SUSV2: isWardicComponent and unwrapWardicComponent: Solid 2's components, marked with what they wrap", () => {
    const Box = (props: { readonly ref?: JSX.Ref<HTMLDivElement> }): JSX.Element => <div ref={props.ref} />
    expect(isWardicComponent(wardic.div)).toBe(true)
    expect(unwrapWardicComponent(wardic.div)).toBe("div")
    expect(unwrapWardicComponent(wardic.create(Box))).toBe(Box)
    expect(isWardicComponent(Box)).toBe(false)
  })

  it("SUSV3: type svg renders a wrapped component's attribute keys as attributes; without it, as style", () => {
    const Dot = (props: Record<string, unknown>): JSX.Element => <circle {...(props as JSX.CircleSVGAttributes<SVGCircleElement>)} />
    const SvgDot = wardic.create(Dot, { type: "svg" })
    const HtmlDot = wardic.create(Dot)
    const [, svg, html] = tagsOf(
      serve(() => (
        <svg>
          <SvgDot initial={{ cx: 10, opacity: 0.5 }} />
          <HtmlDot initial={{ opacity: 0.5 }} />
        </svg>
      )),
    )
    expect(svg?.attrs.cx).toBe("10")
    expect(svg?.attrs.opacity).toBe("0.5")
    expect(html?.attrs.opacity).toBeUndefined()
    expect(html?.style.opacity).toBe("0.5")
  })

  it("SUSV4: WardicConfig's isValidProp keeps a tag's props off it on a server too", () => {
    const props = { tone: "danger" } as Record<string, unknown>
    const [div] = tagsOf(
      serve(() => (
        <WardicConfig isValidProp={(key) => key !== "tone"}>
          <wardic.div {...props} title="t" />
        </WardicConfig>
      )),
    )
    expect(div?.attrs.tone).toBeUndefined()
    expect(div?.attrs.title).toBe("t")
  })

  it("SUSV5: on a server, createPageInView true; createReducedMotionConfig true for always, false else; createAnimationFrame calls nothing", () => {
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
      </WardicProvider>
    ))
    expect(tagsOf(html).filter((t) => t.name === "p").map((p) => p.attrs["data-visible"])).toEqual(["true", "true"])
    expect(html).toMatch(/data-name="provider"[^>]*>true</)
    expect(html).toMatch(/data-name="never"[^>]*>false</)
    expect(frames).toBe(0)
  })
})
