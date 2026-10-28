// A Transition end in a Solid 2 server render (#428, ADR-0057, Q3): the target an element renders
// first sets its own at once, so the markup has it. Solid 1's are TS1–TS3.
//
// - ET4: `initial`'s Transition end, and `animate`'s with `initial={false}`, are in a ward's markup and
//   a `wardic.div`'s; with an `initial`, `animate`'s isn't.
import { ward, wardic } from "@wardic/solid/unstable/v2"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr.ts"

/** The first `name` tag in `html`. */
const first = (html: string, name: string): Tag | undefined => tagsOf(html).find((t) => t.name === name)

describe("a Transition end in a Solid 2 server render (#428)", () => {
  it("ET4: the first target's Transition end is in the markup; a later one's isn't", () => {
    const Panel = () => {
      const panel = ward({ initial: false, animate: { opacity: 0, transitionEnd: { display: "none" } } })
      return <section {...panel} />
    }
    expect(first(serve(() => <Panel />), "section")?.style.display, "a ward's, with initial={false}").toBe("none")
    const initial = serve(() => <wardic.div initial={{ opacity: 0, transitionEnd: { visibility: "hidden" } }} animate={{ opacity: 1 }} />)
    expect(first(initial, "div")?.style.visibility, "initial's").toBe("hidden")
    const later = serve(() => <wardic.div initial={{ opacity: 1 }} animate={{ opacity: 0, transitionEnd: { display: "none" } }} />)
    expect(first(later, "div")?.style.display, "animate's after an initial: the client's").toBeUndefined()
  })
})
