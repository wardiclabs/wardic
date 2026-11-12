// A Batch's members' Appear animations on Solid 2's server (#706, ADR-0044 *Amendment (#706)*): one rule
// for the members on one set of transitions, each member's own values as custom properties, its delay
// its own, under a provider in a page with a head.
//
// - BS1: a staggered grid: each member's own values and `animation: var(--wardic-aN)`, its stagger after
//   it, its Starting style kept; the head's rule, its slot, and the reduced rule under the media query.
// - BS2: opt-in (Q21): a Batch without `appear: true` draws its start, as before, and nothing is said of
//   it; the provider's `appear={false}` and `initial: false` play nothing; `appear="explain"` names a Batch
//   that asked by its keys and says why it waits (an ease with no name, nothing moving), and a member whose
//   own style sets an `animation`, which it keeps.
// - BS3: reduced motion's settings (ADR-0029, #434): `"never"` one rule, `"always"` the reduced one, its
//   positional keys at their targets from its first stop; neither under the media query. Skipped (#468):
//   a rule of 0 s at the targets, and no stagger.
// - BS4: keyed, each item's own, from the list read once; a key the list doesn't have, none; under
//   `<AnimatePresence initial={false}>`, nothing plays and the head holds no rule.
// - BS5: members whose transitions differ (a scale toward 0 runs a Default transition of its own) are two
//   groups: two rules, two slots, each member its group's.
// - BS6 (#245's chunks): a Batch in a stream's late `<Loading>` chunk plays when a Wardic element in that
//   chunk asks for its head patch, which brings the Batch's slot (and its rule, unless the head sent it); in
//   a chunk with none, its members name a slot no patch defines, and keep their start until hydration (Q7).
// - BS7 (Q16, Q20, Q21): a Batch Reorder group's entrance with its `appear`, its `initial`'s keys moving to
//   their identity at each item's place: the items carry only the slot, the rule writes only `opacity`; a
//   grid from its width, items in flow, the same; without `appear`, nothing.
// - BS8 (Q2): a stagger counts the members that move: one that doesn't plays none, and the one after
//   it waits as the second mover.
import { DomLive } from "@wardic/dom"
import * as Appear from "@wardic/dom/Appear"
import { AnimatePresence, createBatch, Reorder, stagger, wardic, WardicConfig, WardicProvider } from "@wardic/solid/unstable/v2"
import { type JSX, renderToStream, renderToString } from "@solidjs/web"
import { createMemo, For, Loading, Show } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { tagsOf } from "./ssr.ts"

/** A whole document with a head, as SolidStart renders it, and `ui` under a provider. */
const page = (ui: () => JSX.Element, provider: { readonly appear?: boolean | "explain"; readonly reducedMotion?: "user" | "always" | "never" } = {}): string =>
  renderToString(() => (
    <html>
      <head>
        <title>t</title>
      </head>
      <body>
        <WardicProvider env={DomLive} {...provider}>
          {ui()}
        </WardicProvider>
      </body>
    </html>
  ))

/** The head's Appear style, or "". */
const headCss = (html: string): string => /<style data-wardic-appear[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ""

/** The style of the tag whose `data-k` is `k`. */
const styleOf = (html: string, k: string): Readonly<Record<string, string>> => tagsOf(html).find((t) => t.attrs["data-k"] === k)?.style ?? {}

/** The `:root` value of `property` in `css`, outside the media block, and inside it. */
const slotOf = (css: string, property: string): { readonly normal: string; readonly reduced: string } => {
  const [plain, media = ""] = css.split("@media (prefers-reduced-motion: reduce)")
  const value = (text: string | undefined) => new RegExp(`${property}:([^;}]*)`).exec(text ?? "")?.[1] ?? ""
  return { normal: value(plain), reduced: value(media) }
}

/** The provider's explanations logged while `render` runs (#585): each `wardic.appear:` line, from its start. */
const said = (render: () => string): ReadonlyArray<string> => {
  const lines: Array<string> = []
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: Array<unknown>) => {
      lines.push(args.map(String).join(" "))
    }),
  )
  try {
    render()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return lines.flatMap((line) => {
    const at = line.indexOf("wardic.appear:")
    if (at === -1) return []
    return [line.slice(at).trim()]
  })
}

const grid = () =>
  createBatch({
    appear: true,
    count: 3,
    initial: { x: 0, opacity: 0 },
    animate: (i) => ({ x: i * 50, opacity: 1 }),
    transition: { type: "spring", stiffness: 300, damping: 30, delay: stagger(0.05) },
  })

describe("a Batch's members' Appear animations on a server (#706)", () => {
  it("BS1: each member's own values, the slot and its stagger; the head's rule, slot and reduced rule", () => {
    const html = page(() => {
      const tiles = grid()
      return (
        <>
          <div data-k="0" {...tiles.at(0)} />
          <div data-k="1" {...tiles.at(1)} />
          <div data-k="2" {...tiles.at(2)} />
        </>
      )
    })
    const [first, second, third] = ["0", "1", "2"].map((k) => styleOf(html, k)) as [Record<string, string>, Record<string, string>, Record<string, string>]
    const property = /^var\((--wardic-a\d+)\)$/.exec(first.animation ?? "")?.[1] ?? ""
    expect(property, "the first member's animation, the slot alone").toMatch(/^--wardic-a\d+$/)
    expect(second.animation).toBe(`var(${property}) 0.05s`)
    expect(third.animation).toBe(`var(${property}) 0.1s`)
    // Each one's own target; what all share is in the rule. Its Starting style stays.
    expect(first["--wardic-x1"]).toBe("0px")
    expect(third["--wardic-x1"]).toBe("100px")
    expect(first["--wardic-opacity1"]).toBeUndefined()
    expect(third.opacity).toBe("0")
    // The head: the rule, the slot's line, and under reduced motion the reduced rule.
    const css = headCss(html)
    const { normal, reduced } = slotOf(css, property)
    const name = normal.split(" ")[0] as string
    expect(name.startsWith(`${Appear.PREFIX}b`)).toBe(true)
    expect(normal).toMatch(new RegExp(`^${name} [\\d.]+s linear 1 forwards$`))
    expect(css).toContain(`@keyframes ${name}{0%{transform:translateX(0px);opacity:0}`)
    const reducedName = reduced.split(" ")[0] as string
    expect(reducedName.startsWith(`${Appear.PREFIX}b`)).toBe(true)
    expect(reducedName).not.toBe(name)
    expect(css).toContain(`@keyframes ${reducedName}{`)
  })

  it("BS2: opt-in: without appear, its start alone and nothing said; the off switches play nothing; explain says why", () => {
    const three = (tiles: { readonly at: (i: number, props?: { readonly style?: JSX.CSSProperties }) => object }) => (
      <>
        <div data-k="0" {...tiles.at(0)} />
        <div data-k="1" {...tiles.at(1, { style: { animation: "spin 1s infinite" } })} />
        <div data-k="2" {...tiles.at(2)} />
      </>
    )
    // Not asked for (Q21): its start, as before.
    const plain = page(() => three(createBatch({ count: 3, initial: { opacity: 0 }, animate: () => ({ opacity: 1 }) })))
    expect(styleOf(plain, "0")).toEqual({ opacity: "0" })
    expect(headCss(plain)).toBe("")
    const off = page(() => three(grid()), { appear: false })
    expect(styleOf(off, "0").animation).toBeUndefined()
    expect(headCss(off)).toBe("")
    const atTargets = page(() => three(createBatch({ appear: true, count: 3, initial: false, animate: (i) => ({ x: i * 10 }) })))
    expect(styleOf(atTargets, "2").animation).toBeUndefined()
    expect(headCss(atTargets)).toBe("")
    // A member whose own style sets an `animation` keeps it; the others play.
    const vetoed = page(() => three(grid()))
    expect(styleOf(vetoed, "1").animation).toBe("spin 1s infinite")
    expect(styleOf(vetoed, "2").animation).toMatch(/^var\(--wardic-a\d+\) 0\.1s$/)

    const lines = said(() =>
      page(
        () => (
          <>
            {three(grid())}
            {three(createBatch({ count: 3, initial: { opacity: 0 }, animate: () => ({ opacity: 1 }) }))}
            {three(createBatch({ appear: true, count: 3, initial: { y: 10 }, animate: () => ({ y: 0 }), transition: { type: "tween", duration: 0.3, ease: (t: number) => t * t } }))}
            {three(createBatch({ appear: true, count: 3, initial: false, animate: (i) => ({ x: i * 10 }) }))}
          </>
        ),
        { appear: "explain" },
      ))
    expect(lines).toEqual([
      "wardic.appear: a Batch's member 1 waits for the JavaScript: its own style sets an animation",
      "wardic.appear: a Batch (y) waits for the JavaScript: its transition holds a function with no easing name",
      "wardic.appear: a Batch (x) waits for the JavaScript: no member moves from its start",
    ])
    // Without "explain", nothing is said.
    expect(said(() => page(() => three(grid())))).toEqual([])
  })

  it("BS3: never, one rule; always, the reduced one, its positional keys at their targets; skipped, 0 s and no stagger", () => {
    const tiles = () => {
      const t = grid()
      return (
        <>
          <div data-k="0" {...t.at(0)} />
          <div data-k="2" {...t.at(2)} />
        </>
      )
    }
    const ruleOf = (html: string) => {
      const css = headCss(html)
      const property = /var\((--wardic-a\d+)\)/.exec(styleOf(html, "2").animation ?? "")?.[1] ?? ""
      const { normal, reduced } = slotOf(css, property)
      const name = normal.split(" ")[0] as string
      return { css, normal, reduced, rule: new RegExp(`@keyframes ${name}\\{([^@]*?)\\}\\}`).exec(css)?.[1] ?? "" }
    }
    const never = ruleOf(page(tiles, { reducedMotion: "never" }))
    expect(never.reduced).toBe("")
    expect(never.css).not.toContain("prefers-reduced-motion")
    expect(never.rule.startsWith("0%{transform:translateX(0px);opacity:0}")).toBe(true)

    // Reduced: `x` snaps at the member's delay, so its first stop draws its target; `opacity` still fades.
    const always = ruleOf(page(tiles, { reducedMotion: "always" }))
    expect(always.css).not.toContain("prefers-reduced-motion")
    expect(always.rule.startsWith("0%{transform:translateX(var(--wardic-x1));opacity:0}")).toBe(true)
    expect(always.rule).toContain("opacity:0.")

    // Skipped: every key lands on its first frame, a rule of 0 s, and no member waits its stagger.
    const skipped = page(() => <WardicConfig skipAnimations>{tiles()}</WardicConfig>)
    const s0 = ruleOf(skipped)
    expect(s0.normal).toMatch(/^wardic-b[\w-]+ 0s linear 1 forwards$/)
    expect(s0.rule).toBe("0%,100%{transform:translateX(var(--wardic-x1));opacity:1")
    expect(styleOf(skipped, "2").animation).toMatch(/^var\(--wardic-a\d+\)$/)
    expect(s0.css).not.toContain("prefers-reduced-motion")
  })

  it("BS4: keyed, each item's own from the list; an unknown key none; under AnimatePresence initial={false}, nothing", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }]
    const list = (quiet: boolean) => () => {
      const rows = createBatch({ appear: true, each: () => items, key: "id", initial: { opacity: 0, y: 20 }, animate: (_, i) => ({ y: i * 40, opacity: 1 }) })
      const ui = () => (
        <>
          <For each={items}>{(item) => <div data-k={item.id} {...rows.member(item.id)} />}</For>
          <div data-k="z" {...rows.member("z")} />
        </>
      )
      return (
        <Show when={quiet} fallback={ui()}>
          <AnimatePresence initial={false}>{ui()}</AnimatePresence>
        </Show>
      )
    }
    const html = page(list(false))
    expect(styleOf(html, "c")["--wardic-y1"]).toBe("80px")
    expect(styleOf(html, "a")["--wardic-y0"], "every item starts at 20: in the rule").toBeUndefined()
    expect(styleOf(html, "b").animation).toMatch(/^var\(--wardic-a\d+\)$/)
    expect(styleOf(html, "z").animation).toBeUndefined()
    expect(headCss(html)).toContain("@keyframes wardic-b")

    const quiet = page(list(true))
    expect(styleOf(quiet, "a").animation).toBeUndefined()
    expect(styleOf(quiet, "c").transform, "at its target").toBe("translateY(80px)")
    expect(headCss(quiet), "no rule a member asked for").toBe("")
  })

  it("BS5: members on different transitions are two groups: two rules, two slots", () => {
    const html = page(() => {
      const shrink = createBatch({ appear: true, count: 2, initial: { scale: 0.5 }, animate: (i) => ({ scale: i }) })
      return (
        <>
          <div data-k="0" {...shrink.at(0)} />
          <div data-k="1" {...shrink.at(1)} />
        </>
      )
    })
    const property = (k: string) => /var\((--wardic-a\d+)\)/.exec(styleOf(html, k).animation ?? "")?.[1] ?? ""
    expect(property("0")).toMatch(/^--wardic-a\d+$/)
    expect(property("1")).toMatch(/^--wardic-a\d+$/)
    expect(property("0")).not.toBe(property("1"))
    const css = headCss(html)
    const names = [property("0"), property("1")].map((p) => slotOf(css, p).normal.split(" ")[0])
    expect(names[0]).not.toBe(names[1])
    expect(css.match(/@keyframes wardic-b/g)?.length, "two rules, and their reduced ones").toBe(4)
  })

  it("BS6: in a late <Loading> chunk, a Batch plays when a Wardic element there asks for its head patch; else its start", async () => {
    const writes: Array<string> = []
    const Tiles = (props: { readonly prefix: string }) => {
      const tiles = grid()
      return (
        <>
          <div data-k={`${props.prefix}0`} {...tiles.at(0)} />
          <div data-k={`${props.prefix}2`} {...tiles.at(2)} />
        </>
      )
    }
    await new Promise<void>((resolve) => {
      renderToStream(() => {
        const after = (ms: number) =>
          createMemo(async () => {
            await new Promise((r) => setTimeout(r, ms))
            return "late"
          })
        const first = after(20)
        // Far enough after the first that a slow runner still sends them as two chunks (AR14's).
        const second = after(500)
        return (
          <html>
            <head>
              <title>t</title>
            </head>
            <body>
              <WardicProvider env={DomLive}>
                <Loading fallback={<p>loading</p>}>
                  {/* Made by the data, so made late: a component that reads none runs in the shell pass. */}
                  <Show when={first()}>
                    <wardic.h1 data-k="title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
                    <Tiles prefix="with" />
                  </Show>
                </Loading>
                <Loading fallback={<p>loading</p>}>
                  <Show when={second()}>
                    <Tiles prefix="alone" />
                  </Show>
                </Loading>
              </WardicProvider>
            </body>
          </html>
        )
      }).pipe({ write: (v: string) => void writes.push(v), end: () => resolve() })
    })
    const patchesOf = (write: string): string =>
      [...write.matchAll(/\(_\$HY\.hp=_\$HY\.hp\|\|\{\}\)\["[^"]+"\]=(\[\[[\s\S]*?\]\]);/g)].flatMap((m) =>
        (JSON.parse(m[1] as string) as ReadonlyArray<ReadonlyArray<unknown>>)
          .filter((patch) => patch[2] === "style" && Object.hasOwn((patch[3] ?? {}) as object, "data-wardic-appear"))
          .map((patch) => String(patch[4]))).join("")
    const withRoot = writes.slice(1).find((w) => w.includes('data-k="with0"')) as string
    const alone = writes.slice(1).find((w) => w.includes('data-k="alone0"')) as string
    // With a Wardic element: its patch brings the members' slot, and the rule unless the head sent it.
    const property = /var\((--wardic-a\d+)\)/.exec(styleOf(withRoot, "with2").animation ?? "")?.[1] ?? ""
    expect(property).toMatch(/^--wardic-a\d+$/)
    const name = new RegExp(`${property}:(wardic-b[\\w-]+) `).exec(patchesOf(withRoot))?.[1] ?? ""
    expect(name).toMatch(/^wardic-b/)
    expect(`${headCss(writes[0] as string)}${patchesOf(withRoot)}`).toContain(`@keyframes ${name}{`)
    // Alone: its members name a slot no patch defines.
    const lonely = /var\((--wardic-a\d+)\)/.exec(styleOf(alone, "alone2").animation ?? "")?.[1] ?? ""
    expect(lonely).toMatch(/^--wardic-a\d+$/)
    expect(writes.join("")).not.toContain(`${lonely}:`)
  })

  it("BS7: a Batch Reorder group's entrance with its appear: the slot alone, opacity alone in the rule; in flow too; without, none", () => {
    const values = ["a", "b", "c"]
    const group = (props: { readonly appear?: boolean; readonly axis?: "y" | "xy" }) => () => {
      const own: { appear?: boolean } = {}
      if (props.appear !== false) own.appear = true
      return (
        <Reorder.BatchGroup values={values} onReorder={() => {}} axis={props.axis ?? "y"} itemSize={{ width: 80, height: 40 }} gap={10} initial={{ opacity: 0 }} {...own}>
          <For each={values}>{(v) => <Reorder.BatchItem value={v} data-k={v}>{v}</Reorder.BatchItem>}</For>
        </Reorder.BatchGroup>
      )
    }
    const column = page(group({}))
    const c = styleOf(column, "c")
    expect(c.animation).toMatch(/^var\(--wardic-a\d+\)$/)
    expect(Object.keys(c).filter((name) => name.startsWith("--wardic-")), "no own values: places don't move").toEqual([])
    expect(c.transform, "at its place").toBe("translateY(100px)")
    expect(c.opacity).toBe("0")
    const css = headCss(column)
    expect(css).toMatch(/@keyframes wardic-b[\w-]+\{0%\{opacity:0\}/)
    expect(css).not.toMatch(/@keyframes wardic-b[^@]*transform/)

    // A grid from its width: items in flow, the grid's, play their fade with no transform.
    const flow = page(group({ axis: "xy" }))
    expect(styleOf(flow, "b").animation).toMatch(/^var\(--wardic-a\d+\)$/)
    expect(styleOf(flow, "b").transform).toBeUndefined()

    const off = page(group({ appear: false }))
    expect(styleOf(off, "c").animation).toBeUndefined()
    expect(headCss(off)).toBe("")
  })

  it("BS8: a stagger counts the members that move: a still one plays none, and the next waits as the second mover", () => {
    const html = page(() => {
      const row = createBatch({
        appear: true,
        count: 3,
        initial: { x: 0, opacity: 0 },
        animate: (i) => ({ x: [50, 0, 100][i] as number, opacity: [1, 0, 1][i] as number }),
        transition: { type: "tween", duration: 0.4, ease: "easeOut", delay: stagger(0.05) },
      })
      return (
        <>
          <div data-k="0" {...row.at(0)} />
          <div data-k="1" {...row.at(1)} />
          <div data-k="2" {...row.at(2)} />
        </>
      )
    })
    const property = /^var\((--wardic-a\d+)\)$/.exec(styleOf(html, "0").animation ?? "")?.[1] ?? ""
    expect(property, "the first mover, its slot alone").toMatch(/^--wardic-a\d+$/)
    expect(styleOf(html, "1").animation, "a still member, none").toBeUndefined()
    expect(styleOf(html, "2").animation, "the second mover's delay, not the third member's").toBe(`var(${property}) 0.05s`)
  })
})
