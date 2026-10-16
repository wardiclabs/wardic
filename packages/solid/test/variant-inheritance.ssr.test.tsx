// Variant inheritance in a server render (#50, ADR-0007 *Amendment (#50)*, ADR-0021): every Wardic
// element provides its variant context, and a Variant child (CONTEXT.md: `variants`, no `initial`
// or `animate` name of its own, `inherit` not false) with no `initial` renders its nearest
// variant ancestor's `initial` name as its Starting style. Only names pass down, read once.
import * as Renderer from "@wardic/core/Renderer"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import { useWardic, wardic } from "@wardic/solid"
import * as Effect from "effect/Effect"
import type { JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

const VARIANTS = { hidden: { opacity: 0, scale: 0.5 }, shown: { opacity: 1, scale: 1 } }

/** The DOM's projection, from the Renderer DomLive provides. */
const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), DomRenderer.layer)).project

/** `tag`'s inline style carries every key of the DOM's projection of `values`. */
const expectStartingStyle = (tag: Tag | undefined, values: Record<string, unknown>): void => {
  const patch = domProject(values)
  for (const key in patch) expect(tag?.style[key], `${tag?.name} style ${key}`).toBe(String(patch[key]))
}

/** The first `name` tag in `html`. */
const first = (html: string, name: string): Tag | undefined => tagsOf(html).find((t) => t.name === name)

/** A component that forwards its ref and applies `props.style` to its root, with its children inside. */
const Card = (p: { ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties | string; children?: JSX.Element }): JSX.Element => (
  <article ref={p.ref} style={p.style}>
    {p.children}
  </article>
)
const WCard = wardic.create(Card)

describe("variant inheritance in a server render (#50)", () => {
  it("VI1: a wardic.* parent's initial name is its Variant child's Starting style", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.li variants={VARIANTS}>a</wardic.li>
      </wardic.ul>
    ))
    expectStartingStyle(first(html, "li"), VARIANTS.hidden)
  })

  it("VI2: through useWardic's ward.Provider too", () => {
    function List(): JSX.Element {
      const ward = useWardic({ initial: "hidden", animate: "shown", variants: VARIANTS })
      return (
        <ul {...ward()}>
          <ward.Provider>
            <wardic.li variants={VARIANTS}>a</wardic.li>
          </ward.Provider>
        </ul>
      )
    }
    expectStartingStyle(first(serve(() => <List />), "li"), VARIANTS.hidden)
  })

  it("VI3: an element with no variants of its own passes the names through", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.div animate={{ x: 0 }}>
          <wardic.li variants={VARIANTS}>a</wardic.li>
        </wardic.div>
      </wardic.ul>
    ))
    expectStartingStyle(first(html, "li"), VARIANTS.hidden)
  })

  it("VI4: an element without variants inherits nothing", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.span animate={{ opacity: 1 }}>a</wardic.span>
      </wardic.ul>
    ))
    expect(first(html, "span")?.style).toEqual({})
  })

  it("VI5: inherit={false} keeps a Variant child out", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.li variants={VARIANTS} inherit={false}>
          a
        </wardic.li>
      </wardic.ul>
    ))
    expect(first(html, "li")?.style).toEqual({})
  })

  it("VI6: inherit={false} on an element in between passes no names from above it", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.div inherit={false}>
          <wardic.li variants={VARIANTS}>a</wardic.li>
        </wardic.div>
      </wardic.ul>
    ))
    expect(first(html, "li")?.style).toEqual({})
  })

  it("VI7: a child that names its own initial keeps it", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.li variants={VARIANTS} initial="shown">
          a
        </wardic.li>
      </wardic.ul>
    ))
    expectStartingStyle(first(html, "li"), VARIANTS.shown)
  })

  it("VI8: a values-map initial hands down no name", () => {
    const html = serve(() => (
      <wardic.ul initial={{ opacity: 0 }} animate="shown" variants={VARIANTS}>
        <wardic.li variants={VARIANTS}>a</wardic.li>
      </wardic.ul>
    ))
    expect(first(html, "li")?.style).toEqual({})
  })

  it("VI9: a component wrap inherits as a Variant child, through its style", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <WCard variants={VARIANTS}>a</WCard>
      </wardic.ul>
    ))
    expectStartingStyle(first(html, "article"), VARIANTS.hidden)
  })

  it("VI10: a component wrap passes its names to the component's children", () => {
    const html = serve(() => (
      <WCard initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.span variants={VARIANTS}>a</wardic.span>
      </WCard>
    ))
    expectStartingStyle(first(html, "span"), VARIANTS.hidden)
  })
})
