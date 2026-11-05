// Which elements name their own variants, Motion's `isControllingVariants` (#618, decision 8): a name
// on any variant prop, `initial`, `animate`, the five `while*` or `exit`. Such an element is no Variant
// child: it doesn't take its parent's names, nor a stagger slot among its children.
//
// - VC1: a child with a named `whileHover` keeps its own look while its parent's `animate` name changes
//   its siblings, and takes no stagger slot: the sibling after it starts first.
// - VC2: a child with a named `exit` doesn't follow its parent's names either.
// - VC3: a child with an object `whileHover` is still a Variant child: it follows.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { afterEach, expect, it } from "vitest"
import { opacityOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const CHILD = { hidden: { opacity: 0.2 }, shown: { opacity: 0.8 }, hover: { opacity: 0.5 } }
const PARENT = { hidden: {}, shown: { transition: { staggerChildren: 0.5 } } }
const QUICK = { duration: 0.05 }

/** What the element shows: its computed opacity, its own style or none. */
const shownOpacity = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

it("VC1: a child with a named whileHover keeps its own look and takes no stagger slot", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div variants={PARENT} initial="hidden" animate="shown">
        <wardic.div data-named variants={CHILD} whileHover="hover" transition={QUICK} />
        <wardic.div data-follower variants={CHILD} transition={QUICK} />
      </wardic.div>
    </WardicProvider>
  ))
  const named = container.querySelector("[data-named]") as HTMLElement
  const follower = container.querySelector("[data-follower]") as HTMLElement
  await raf()
  // The first slot is the follower's: it's past its start well before the 0.5 s a second slot waits.
  await wait(250)
  expect(opacityOf(follower), "the follower started in the first slot").toBeGreaterThan(0.5)
  await until(() => Math.abs(opacityOf(follower) - 0.8) < 0.01)
  expect(shownOpacity(named), "its own look: no inherited name").toBe(1)
})

it("VC2: a child with a named exit doesn't follow its parent's names", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div variants={PARENT} initial="hidden" animate="shown">
        <wardic.div data-named variants={CHILD} exit="hidden" transition={QUICK} />
        <wardic.div data-follower variants={CHILD} transition={QUICK} />
      </wardic.div>
    </WardicProvider>
  ))
  const named = container.querySelector("[data-named]") as HTMLElement
  const follower = container.querySelector("[data-follower]") as HTMLElement
  await until(() => Math.abs(opacityOf(follower) - 0.8) < 0.01)
  expect(shownOpacity(named)).toBe(1)
})

it("VC3: a child with an object whileHover is still a Variant child", async () => {
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div variants={PARENT} initial="hidden" animate="shown">
        <wardic.div data-child variants={CHILD} whileHover={{ scale: 1.1 }} transition={QUICK} />
      </wardic.div>
    </WardicProvider>
  ))
  const child = container.querySelector("[data-child]") as HTMLElement
  await until(() => Math.abs(opacityOf(child) - 0.8) < 0.01)
})
