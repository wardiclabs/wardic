// A Transition end in a server render (#428, ADR-0057, Q3): the target an element renders first sets
// its own at once, so the server's markup has it, and a hydration finds it; any later target's waits
// for the client. Solid 1's browser tests are TE1–TE9.
//
// - TS1: `initial`'s Transition end is in the markup beside its values.
// - TS2: with `initial={false}`, `animate`'s is, a closed panel rendered hidden; through a variant
//   name too.
// - TS3: with an `initial`, `animate`'s isn't: it sets once the entrance lands, on the client.
// - TS4: a list of names rendered first merges its names' Transition ends, a later name's winning a
//   key both set.
import { createWard, wardic } from "@wardic/solid"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

/** The first `name` tag in `html`. */
const first = (html: string, name: string): Tag | undefined => tagsOf(html).find((t) => t.name === name)

describe("a Transition end in a server render (#428)", () => {
  it("TS1: initial's Transition end is in the markup", () => {
    const html = serve(() => <wardic.div initial={{ opacity: 0, transitionEnd: { display: "none" } }} animate={{ opacity: 1 }} />)
    expect(first(html, "div")?.style.display).toBe("none")
    expect(first(html, "div")?.style.opacity).toBe("0")
  })

  it("TS2: with initial={false}, animate's is, a closed panel rendered hidden, through a variant name too", () => {
    const closed = { opacity: 0, transitionEnd: { display: "none" } }
    const map = serve(() => <wardic.div initial={false} animate={closed} />)
    expect(first(map, "div")?.style.display).toBe("none")
    const named = serve(() => <wardic.div initial={false} animate="closed" variants={{ closed, open: { opacity: 1, display: "block" } }} />)
    expect(first(named, "div")?.style.display).toBe("none")
    const Panel = () => {
      const ward = createWard({ initial: false, animate: closed })
      return <section {...ward()} />
    }
    expect(first(serve(() => <Panel />), "section")?.style.display, "createWard's too").toBe("none")
  })

  it("TS3: with an initial, animate's Transition end waits for the client", () => {
    const html = serve(() => <wardic.div initial={{ opacity: 1 }} animate={{ opacity: 0, transitionEnd: { display: "none" } }} />)
    expect(first(html, "div")?.style.display).toBeUndefined()
  })

  it("TS4: a list of names rendered first merges its names' Transition ends, the later name's winning", () => {
    const variants = { low: { opacity: 0, transitionEnd: { display: "none", "--from": "low" } }, hidden: { scale: 0.5, transitionEnd: { display: "contents" } } }
    const html = serve(() => <wardic.div initial={["low", "hidden"]} animate={{ opacity: 1 }} variants={variants} />)
    expect(first(html, "div")?.style.display, "the later name's").toBe("contents")
    expect(first(html, "div")?.style["--from"], "the earlier name's other key").toBe("low")
  })
})
