// Regression: the measure pass must reset EVERY node's transform BEFORE any box is
// read (issue #1, ADR-0009 / Motion's read/write phase split). `getBoundingClientRect`
// is viewport-space, so a node measured while an ANCESTOR projection node is
// mid-animation reads an ancestor-transform-polluted box — and the old interleaved
// loop restored each node's transform in a `finally` before the next node was read,
// so a wider reset inside `measureLayoutBox` could not have fixed it.
//
// Needs real layout: happy-dom zeroes `getBoundingClientRect`, so this tier is the
// only one that can catch it.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { LayoutGroup, wardic, WardicProvider } from "@wardic/solid"
import { createSignal } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { leftOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const CSS = `
  .mp-stage{position:relative;width:800px;height:300px}
  .mp-parent{position:absolute;top:0;left:0;width:200px;height:200px}
  .mp-parent.moved{left:300px}
  .mp-child{position:absolute;top:10px;left:10px;width:120px;height:120px}
  .mp-grandchild{position:absolute;top:10px;left:10px;width:60px;height:60px}
  .mp-sibling{position:absolute;top:150px;left:30px;width:40px;height:40px}
  .mp-spacer{position:absolute;top:250px;left:0;width:10px;height:10px}
  .mp-spacer.wide{width:40px}
`

/**
 * A parent layout node moves; mid-flight a SECOND measure pass is triggered (a
 * sibling's `layoutDependency` changes) while the parent still carries its FLIP
 * transform. Descendants are measured after the parent in depth order, so with the
 * old interleaved reset they read the parent's live transform and seed a bogus FLIP
 * — the child visibly tears away from the parent. The invariant is that a
 * descendant whose own layout never changed stays glued at its authored inset for
 * every frame of the animation.
 *
 * The subtree deliberately holds descendants at TWO depths on two sibling chains
 * (`child` > `grandchild`, and `sibling`): defect (b) — the per-node restore in a
 * `finally` — makes the deeper node wrong however the reset's scope is widened, so
 * the depth spread is what discriminates a pass-level split from an in-place fix.
 */
it("a mid-animation re-measure does not pollute descendant boxes with the ancestor's transform", async () => {
  const [moved, setMoved] = createSignal(false)
  const [wide, setWide] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <style>{CSS}</style>
      <LayoutGroup layoutDependency={`${moved()}:${wide()}`}>
        <div class="mp-stage">
          <wardic.div data-parent class="mp-parent" classList={{ moved: moved() }} layout>
            <wardic.div data-child class="mp-child" layout>
              <wardic.div data-grandchild class="mp-grandchild" layout />
            </wardic.div>
            <wardic.div data-sibling class="mp-sibling" layout />
          </wardic.div>
          <wardic.div data-spacer class="mp-spacer" classList={{ wide: wide() }} layout />
        </div>
      </LayoutGroup>
    </WardicProvider>
  ))
  const parent = container.querySelector("[data-parent]") as HTMLElement
  const child = container.querySelector("[data-child]") as HTMLElement
  const grandchild = container.querySelector("[data-grandchild]") as HTMLElement
  const sibling = container.querySelector("[data-sibling]") as HTMLElement
  await raf()
  await raf()

  const parent0 = leftOf(parent)
  const childInset = leftOf(child) - parent0 // 10
  const grandchildInset = leftOf(grandchild) - parent0 // 20
  const siblingInset = leftOf(sibling) - parent0 // 30
  expect(childInset).toBeCloseTo(10, 0)
  expect(grandchildInset).toBeCloseTo(20, 0)
  expect(siblingInset).toBeCloseTo(30, 0)

  setMoved(true) // parent 0 -> 300; the whole subtree is carried along
  // Let the parent get genuinely mid-flight (transform applied, progress < 1).
  await until(() => leftOf(parent) > parent0 + 20 && leftOf(parent) < parent0 + 280)
  expect(leftOf(parent)).toBeLessThan(parent0 + 280)

  // The interrupting trigger: an unrelated sibling changes, re-measuring the WHOLE
  // tree while the parent still carries its FLIP transform.
  setWide(true)

  let worstChild = 0
  let worstGrandchild = 0
  let worstSibling = 0
  await until(() => {
    worstChild = Math.max(worstChild, Math.abs(leftOf(child) - leftOf(parent) - childInset))
    worstGrandchild = Math.max(worstGrandchild, Math.abs(leftOf(grandchild) - leftOf(parent) - grandchildInset))
    worstSibling = Math.max(worstSibling, Math.abs(leftOf(sibling) - leftOf(parent) - siblingInset))
    return Math.abs(leftOf(parent) - (parent0 + 300)) < 1
  })

  // Sub-pixel drift between the parent's and the descendants' frames is fine; a
  // polluted read shows up as a divergence of the ancestor's mid-flight offset
  // (tens to hundreds of px).
  expect(worstChild).toBeLessThan(3)
  expect(worstGrandchild).toBeLessThan(3)
  expect(worstSibling).toBeLessThan(3)
  expect(leftOf(child) - leftOf(parent)).toBeCloseTo(childInset, 0)
  expect(leftOf(grandchild) - leftOf(parent)).toBeCloseTo(grandchildInset, 0)
  expect(leftOf(sibling) - leftOf(parent)).toBeCloseTo(siblingInset, 0)
})
