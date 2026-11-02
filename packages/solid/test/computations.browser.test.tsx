// What a Solid 1 element's computations are (#525, the part-2 grill's Q4): each one exists only when
// its input can change. Counted under each element's own owner (a `<For>` item's root), Solid's
// development component wrappers left out, as a production build has none.
//
// - CC1: a plain `wardic.div`, its keys fixed and no gesture key or children given, makes 4: its mount
//   effect, its Retarget effect, its target memo and its props' render effect.
// - CC2: given `whileHover`, it watches for its gestures too: 5.
// - CC3: given children, it inserts them too: 5.
// - CC4: a reactive spread's keys can change, so it watches for gestures and takes Solid's own spread.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, getOwner, type JSX, type Owner } from "solid-js"
import { render } from "solid-js/web"
import { describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

/** A computation as Solid 1 keeps it: what it owns, and the function it runs. */
interface Computation {
  readonly owned: ReadonlyArray<Computation> | null
  readonly fn?: unknown
}

/** Every computation under `owner`, a development component wrapper left out. */
const computationsUnder = (owner: Computation): ReadonlyArray<Computation> =>
  (owner.owned ?? []).flatMap((c) => [c, ...computationsUnder(c)]).filter((c) => !String(c.fn).includes("$DEVCOMP"))

/** How many computations one element `element()` makes, under its own owner. */
const countOf = async (element: () => JSX.Element): Promise<number> => {
  let owner: Owner | null = null
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => (
      <WardicProvider env={DomLive}>
        <For each={[0]}>
          {() => {
            owner = getOwner()
            return element()
          }}
        </For>
      </WardicProvider>
    ),
    host,
  )
  await raf()
  await raf()
  const count = computationsUnder(owner as unknown as Computation).length
  dispose()
  host.remove()
  return count
}

describe("a Solid 1 element's computations (#525)", () => {
  it("CC1: a plain wardic.div makes 4: its mount, its Retarget, its target and its props", async () => {
    expect(await countOf(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />)).toBe(4)
  })

  it("CC2: given whileHover, it watches for its gestures too", async () => {
    expect(await countOf(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileHover={{ opacity: 0.5 }} />)).toBe(5)
  })

  it("CC3: given children, it inserts them too", async () => {
    expect(await countOf(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>a</wardic.div>)).toBe(5)
  })

  it("CC4: a reactive spread can gain keys, so it watches for gestures and takes Solid's own spread", async () => {
    const [props] = createSignal<Record<string, unknown>>({ initial: { opacity: 0 }, animate: { opacity: 1 } })
    const plain = await countOf(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />)
    expect(await countOf(() => <wardic.div {...props()} />)).toBeGreaterThan(plain)
  })
})
