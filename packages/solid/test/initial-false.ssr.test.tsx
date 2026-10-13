// `initial={false}` in a server render (#134, ADR-0003 *Amendment (#134)*, ADR-0021): the element's
// Starting style is its `animate`, resolved once, so the markup is where it rests and nothing
// animates at mount. A Variant child takes `false` from an ancestor that names its own variants,
// and `<AnimatePresence initial={false}>` starts the child it renders at its `animate`.
import * as Renderer from "@wardic/core/Renderer"
import { RendererDomLive } from "@wardic/dom"
import { AnimatePresence, useWardic, wardic } from "@wardic/solid"
import * as Effect from "effect/Effect"
import type { JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

const VARIANTS = { hidden: { opacity: 0, scale: 0.5 }, shown: { opacity: 1, scale: 1.2 } }

/** The DOM's projection, from the Renderer DomLive provides. */
const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), RendererDomLive)).project

/** `tag`'s inline style carries every key of the DOM's projection of `values`. */
const expectStartingStyle = (tag: Tag | undefined, values: Record<string, unknown>): void => {
  const patch = domProject(values)
  for (const key in patch) expect(tag?.style[key], `${tag?.name} style ${key}`).toBe(String(patch[key]))
}

/** The first `name` tag in `html`. */
const first = (html: string, name: string): Tag | undefined => tagsOf(html).find((t) => t.name === name)

/** A component that forwards its ref and applies `props.style` to its root. */
const Card = (p: { ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties | string; children?: JSX.Element }): JSX.Element => (
  <article ref={p.ref} style={p.style}>
    {p.children}
  </article>
)
const WCard = wardic.create(Card)

describe("initial={false} in a server render (#134)", () => {
  it("IS1: a wardic.div renders its animate values map", () => {
    const html = serve(() => <wardic.div initial={false} animate={{ opacity: 0.5, scale: 2 }} />)
    expectStartingStyle(first(html, "div"), { opacity: 0.5, scale: 2 })
  })

  it("IS2: an animate variant name resolves through its variants", () => {
    const html = serve(() => <wardic.div initial={false} animate="shown" variants={VARIANTS} />)
    expectStartingStyle(first(html, "div"), VARIANTS.shown)
  })

  it("IS3: through useWardic and a component wrap too", () => {
    function Spread(): JSX.Element {
      const ward = useWardic({ initial: false, animate: { opacity: 0.4 } })
      return <section {...ward()} />
    }
    expectStartingStyle(first(serve(() => <Spread />), "section"), { opacity: 0.4 })
    expectStartingStyle(first(serve(() => <WCard initial={false} animate={{ opacity: 0.3 }} />), "article"), { opacity: 0.3 })
  })

  it("IS4: a Variant child takes false from an ancestor that names its variants, and starts at its inherited animate", () => {
    const html = serve(() => (
      <wardic.ul initial={false} animate="shown" variants={VARIANTS}>
        <wardic.li variants={VARIANTS}>a</wardic.li>
      </wardic.ul>
    ))
    expectStartingStyle(first(html, "ul"), VARIANTS.shown)
    expectStartingStyle(first(html, "li"), VARIANTS.shown)
  })

  it("IS5: a child with an initial of its own keeps it", () => {
    const html = serve(() => (
      <wardic.ul initial={false} animate="shown" variants={VARIANTS}>
        <wardic.li initial={{ opacity: 0.1 }} variants={VARIANTS}>
          a
        </wardic.li>
      </wardic.ul>
    ))
    expectStartingStyle(first(html, "li"), { opacity: 0.1 })
  })

  it("IS6: an element that names no variants keeps its own false, and passes its ancestors' names through", () => {
    const html = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.section initial={false} animate={{ opacity: 0.7 }}>
          <wardic.li variants={VARIANTS}>a</wardic.li>
        </wardic.section>
      </wardic.ul>
    ))
    expectStartingStyle(first(html, "section"), { opacity: 0.7 })
    expectStartingStyle(first(html, "li"), VARIANTS.hidden)
  })

  it("IS7: inherit={false} cuts it off", () => {
    const html = serve(() => (
      <wardic.ul initial={false} animate="shown" variants={VARIANTS}>
        <wardic.li inherit={false} variants={VARIANTS}>
          a
        </wardic.li>
      </wardic.ul>
    ))
    expect(first(html, "li")?.style.opacity).toBeUndefined()
  })

  it("IS8: <AnimatePresence initial={false}> renders its child at animate, over the child's own initial", () => {
    const html = serve(() => (
      <AnimatePresence initial={false}>
        <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} />
      </AnimatePresence>
    ))
    expectStartingStyle(first(html, "div"), { opacity: 0.5 })
  })

  it("IS9 (guard): without initial={false} the presence's child renders its own initial", () => {
    const html = serve(() => (
      <AnimatePresence>
        <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} />
      </AnimatePresence>
    ))
    expectStartingStyle(first(html, "div"), { opacity: 0 })
  })
})
