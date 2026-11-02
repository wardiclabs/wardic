// What a Solid 2 element's computations are (#525, the part-2 grill's Q4), as
// `../computations.browser.test.tsx` counts Solid 1's: each one exists only when its input can change.
// Counted under each element's own owner (a `<For>` item's), its components' owners left out.
//
// - CCV1: a plain `wardic.div`, its keys fixed and no gesture key given, makes 3: its props' effect, its
//   mount and Retarget effect, and its target memo.
// - CCV2: given `whileHover`, it watches for a late gesture too: 4.
// - CCV3: a spread whose keys can change (a call's) watches for gestures, and its spread can't see its keys.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { flush, For, getOwner } from "solid-js"
import { type JSX, render } from "@solidjs/web"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"

/** An owner as Solid 2 links them: its first child and its next sibling; a computation has a `_fn`. */
interface OwnerNode {
  readonly _firstChild?: OwnerNode | null
  readonly _nextSibling?: OwnerNode | null
  readonly _fn?: unknown
}

/** Every computation under `owner`, its plain owners (a component's) left out. */
const computationsUnder = (owner: OwnerNode): ReadonlyArray<OwnerNode> => {
  const out: Array<OwnerNode> = []
  const visit = (node: OwnerNode | null | undefined): void => {
    if (node === null || node === undefined) return
    if (node._fn !== undefined) out.push(node)
    visit(node._firstChild)
    visit(node._nextSibling)
  }
  visit(owner._firstChild)
  return out
}

/** How many computations one element `element()` makes, under its own owner. */
const countOf = async (element: () => JSX.Element): Promise<number> => {
  let owner: unknown
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
  flush()
  await raf()
  await raf()
  const count = computationsUnder(owner as OwnerNode).length
  dispose()
  host.remove()
  return count
}

describe("a Solid 2 element's computations (#525)", () => {
  it("CCV1: a plain wardic.div makes 3: its props, its mount and Retarget, its target", async () => {
    expect(await countOf(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />)).toBe(3)
  })

  it("CCV2: given whileHover, it watches for a late gesture too", async () => {
    expect(await countOf(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileHover={{ opacity: 0.5 }} />)).toBe(4)
  })

  it("CCV3: a spread whose keys can change makes more", async () => {
    // A call in a spread is a source Solid reads as it goes: its keys can change.
    const props = (): Record<string, unknown> => ({ initial: { opacity: 0 }, animate: { opacity: 1 } })
    const plain = await countOf(() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />)
    expect(await countOf(() => <wardic.div {...props()} />)).toBeGreaterThan(plain)
  })
})
