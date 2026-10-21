/**
 * Scenario 7 on the Solid 2 binding (#209 PR 5): Solid 1's (`../scenarios/s7-layout-id-switch.tsx`),
 * its writes as a Solid 2 app makes them.
 *
 * Scenario 7: a click swaps two `layoutId` twins, on the page, inside
 * `layoutScroll` containers (issue #13), or into a scaled modal (issue #136).
 *
 * The stage holds exactly one of two 64x64 `wardic.div` twins sharing a
 * `layoutId`, swapped on Run; twin B has the alternate colour. The Container
 * select picks where they sit:
 *
 * - `page`: directly in the stage, both at top 48px, twin A at left 32px and twin
 *   B at left 224px, 192px apart, swapped under one `<Show>`. With the page
 *   scrolled this is #13 as reported.
 * - `shared`: both inside one `layoutScroll` box that fills the stage and holds
 *   480px of content. The twins sit 168px down the content (same lefts as `page`)
 *   and the box starts scrolled 120px, so they show at 48px. Twins that share a
 *   container.
 * - `split`: twin A in a left `layoutScroll` box (content top 168px, scrolled
 *   120px), twin B in a right one (content top 88px, scrolled 40px), each under its
 *   own `<Show>`. Both show at 48px, 176px apart, so a correct switch is purely
 *   horizontal. Folding each twin with its own container's scroll (the option #13
 *   rejected) would start the enterer 80px off vertically.
 * - `scaled`: twin A on the page as in `page`; twin B in a "modal" that a
 *   `transform: scale(0.5)` shrinks (ADR-0012, *Amendment (#136)*). The modal is
 *   224px square at left 192px, top 24px, from its top-left corner, so it paints
 *   112px square; twin B sits 80px in, so it paints 32px square at left 232px, top
 *   64px. Twins are compared where they paint, so A to B shrinks straight into the
 *   modal and B to A grows straight out. Before #136 the A to B switch measured B
 *   as painted but moved it in the modal's frame, so its first frame landed halfway,
 *   the `wrong-origin` verdict; B to A was already right.
 *
 * Changing the select rebuilds the stage at once (twin A showing, the boxes back
 * at their starting scroll) and starts no run. Each mode uses its own `layoutId`,
 * so the rebuild itself animates nothing. Either box can be scrolled by hand
 * before Run. Run marks the trigger as `layoutId-switch/<mode>`, with the boxes'
 * live `scrollTop` as the run's `triggerMeta`, then swaps the twins. The newly
 * mounted twin hands itself to `ctx.watch` from its ref, a mid-run retarget (it is
 * not connected yet at that point), and Wardic FLIPs it from the leaver's box.
 * Repeated runs alternate A to B and B to A.
 *
 * @module
 */
import { wardic } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createSignal, Match, onSettled, Show, Switch } from "solid-js"
import { CONTROLS_STYLE, NOTE_STYLE, type Option, Select } from "../scenarios/controls.tsx"
import type { ScenarioDef, TriggerMeta } from "../scenarios/types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "layout-id-switch"

/** Where the twins sit. */
type Container = "page" | "shared" | "split" | "scaled"

/** The container choices, in the order the select lists them. */
const CONTAINERS: ReadonlyArray<Option<Container>> = [
  { value: "page", label: "page (no container)" },
  { value: "shared", label: "shared: one layoutScroll box" },
  { value: "split", label: "split: two layoutScroll boxes" },
  { value: "scaled", label: "scaled: twin B in a scale(0.5) modal (#136)" },
]

/** The `layoutId` both twins share in `mode`: one per mode, so a rebuild never switches. */
const layoutIdOf = (mode: Container): string => `lab-s7-${mode}`

/** The View root: the controls, the stage, the Run button and a note, stacked. */
const ROOT_STYLE: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "flex-start",
  gap: "8px",
}

/** An absolutely positioned twin at `top`/`left` px within its parent. */
const at = (top: number, left: number): JSX.CSSProperties => ({ position: "absolute", top: `${top}px`, left: `${left}px` })

/** A `layoutScroll` box filling the stage (`shared`). */
const SHARED_BOX_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "0",
  left: "0",
  width: "100%",
  height: "100%",
  overflow: "auto",
}

/** A `layoutScroll` box, 152px wide and full stage height, at `left` px (`split`). */
const splitBoxStyle = (left: number): JSX.CSSProperties => ({
  position: "absolute",
  top: "0",
  left: `${left}px`,
  width: "152px",
  height: "100%",
  overflow: "auto",
})

/** The `scaled` modal: 224px square, shrunk to half from its top-left corner, so it paints 112px square. */
const MODAL_STYLE: JSX.CSSProperties = {
  position: "absolute",
  top: "24px",
  left: "192px",
  width: "224px",
  height: "224px",
  transform: "scale(0.5)",
  "transform-origin": "0 0",
  border: "2px dashed var(--lab-border)",
  "box-sizing": "border-box",
}

/** The scrollable content inside a box: 480px tall, the twins' positioning context. */
const CONTENT_STYLE: JSX.CSSProperties = { position: "relative", height: "480px" }

/**
 * A `layoutScroll` box that scrolls to `initialScrollTop` once it is in the
 * document (a ref runs before insertion, when `scrollTop` cannot be set yet).
 */
const ScrollBox = (props: {
  readonly style: JSX.CSSProperties
  readonly initialScrollTop: number
  readonly onBox: (el: HTMLElement) => void
  readonly children: JSX.Element
}): JSX.Element => {
  let box: HTMLElement | undefined
  onSettled(() => {
    if (box !== undefined) box.scrollTop = props.initialScrollTop
  })
  return (
    <wardic.div
      ref={(el) => {
        box = el
        props.onBox(el)
      }}
      layoutScroll
      style={props.style}
    >
      <div style={CONTENT_STYLE}>{props.children}</div>
    </wardic.div>
  )
}

/**
 * The scenario View. Changing the Container select rebuilds the stage; Run marks
 * the trigger (with the live container scrolls) while the current twin is watched,
 * then swaps the twins.
 */
const View: ScenarioDef["View"] = (props) => {
  const [container, setContainer] = createSignal<Container>("page")
  const [showB, setShowB] = createSignal(false)
  // The current mode's scroll boxes (`shared` uses boxA only), for `triggerMeta`.
  let boxA: HTMLElement | undefined
  let boxB: HTMLElement | undefined

  // Solid 2 applies both at its flush.
  const choose = (next: Container): void => {
    setShowB(false)
    setContainer(next)
  }

  /** The live container scroll, read in the click, before the swap. */
  const meta = (): TriggerMeta | undefined => {
    switch (container()) {
      case "page":
      case "scaled":
        return undefined
      case "shared":
        return { scroll: boxA?.scrollTop ?? 0 }
      case "split":
        return { scrollA: boxA?.scrollTop ?? 0, scrollB: boxB?.scrollTop ?? 0 }
    }
  }

  const run = (): void => {
    props.ctx.markTrigger(`layoutId-switch/${container()}`, meta())
    setShowB((b) => !b)
  }

  // Each twin's ref calls ctx.watch, so the lab follows whichever twin is mounted.
  // On a swap the new twin's ref runs mid-run, before the twin is inserted.
  const twinA = (mode: Container, style: JSX.CSSProperties): JSX.Element => (
    <wardic.div ref={(el) => props.ctx.watch(el)} class="box" layoutId={layoutIdOf(mode)} style={style}>
      A
    </wardic.div>
  )
  const twinB = (mode: Container, style: JSX.CSSProperties): JSX.Element => (
    <wardic.div ref={(el) => props.ctx.watch(el)} class="box alt" layoutId={layoutIdOf(mode)} style={style}>
      B
    </wardic.div>
  )

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div style={CONTROLS_STYLE}>
        <Select
          label="Container"
          name="layout-id-switch-container"
          options={CONTAINERS}
          value={container()}
          onChange={choose}
        />
      </div>
      <div class="stage">
        <Switch>
          <Match when={container() === "page"}>
            <Show when={showB()} fallback={twinA("page", at(48, 32))}>
              {twinB("page", at(48, 224))}
            </Show>
          </Match>
          <Match when={container() === "shared"}>
            <ScrollBox style={SHARED_BOX_STYLE} initialScrollTop={120} onBox={(el) => (boxA = el)}>
              <Show when={showB()} fallback={twinA("shared", at(168, 32))}>
                {twinB("shared", at(168, 224))}
              </Show>
            </ScrollBox>
          </Match>
          <Match when={container() === "split"}>
            <ScrollBox style={splitBoxStyle(0)} initialScrollTop={120} onBox={(el) => (boxA = el)}>
              <Show when={!showB()}>{twinA("split", at(168, 32))}</Show>
            </ScrollBox>
            <ScrollBox style={splitBoxStyle(168)} initialScrollTop={40} onBox={(el) => (boxB = el)}>
              <Show when={showB()}>{twinB("split", at(88, 40))}</Show>
            </ScrollBox>
          </Match>
          <Match when={container() === "scaled"}>
            <Show when={!showB()}>{twinA("scaled", at(48, 32))}</Show>
            <div style={MODAL_STYLE}>
              <Show when={showB()}>{twinB("scaled", at(80, 80))}</Show>
            </div>
          </Match>
        </Switch>
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
      <p style={NOTE_STYLE}>
        shared/split put the twins in layoutScroll boxes (scroll them by hand before Run). split is the case where
        folding each twin with its own container's scroll would start the enterer 80px off. scaled puts twin B in a
        modal shrunk by a transform: each switch should run straight between where the twins paint (#136).
      </p>
    </div>
  )
}

/**
 * Scenario 7, layoutId switch: a click swaps two `layoutId` twins under `<Show>` —
 * on the page, in one `layoutScroll` box, across two, or into a scaled modal — and the new twin's mount
 * queues the Measure pass. Expected to be safe, holding 0. The engine ResizeObserver's first
 * delivery for the new twin is skipped where it reports the box the pass measured (#21, at
 * DPR 1 and 1.35), and runs a second pass that seeds nothing where its rounding differs (at
 * DPR 2.79, a phone).
 */
export const s7: ScenarioDef = {
  id: ID,
  index: 7,
  title: "layoutId switch",
  mechanism:
    "The Run click swaps two layoutId twins under <Show> (on the page, inside layoutScroll boxes, or into a scale(0.5) modal); the new twin's mount registers its projection node, which queues a Measure pass.",
  prediction: "safe",
  expectedHeld: 0,
  rationale:
    "The <Show> swap runs at Solid 2's flush, a microtask of the click task: Solid disposes the leaver, whose projection node captures " +
    "its box in the Root frame and holds it for the rest of the task, then the new twin's mount effect registers its " +
    "projection node and takes that seed. The registration queues a Measure pass, which runs at the end of the click " +
    "task, rebases the seed into the new twin's frame, FLIPs it from the leaver's painted box and flushes that seed " +
    "(ADR-0018), so the first painted frame is already one step along (held 0). The engine's ResizeObserver then " +
    "makes its first delivery for the new twin after the next frame's tick. Where it reports the box the pass " +
    "measured, the engine skips it (ADR-0018, Amendment (#21)): passes 1, as at DPR 1 and 1.35. Where its rounding " +
    "differs, as at DPR 2.79 (a phone), the pass it runs finds the running twin's box unchanged and leaves it " +
    "alone: passes 2 (1 seeding). In the scaled mode each twin's box leaves out the modal's scale, and the seed is converted between " +
    "the twins as painted (ADR-0012, Amendment (#136)), so the switch runs straight between where they paint.",
  View,
}
