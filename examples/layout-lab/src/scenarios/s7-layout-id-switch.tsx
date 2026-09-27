/**
 * Scenario 7: a click swaps two `layoutId` twins, on the page or inside
 * `layoutScroll` containers (issue #13).
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
import { wardic } from "@wardic/solid"
import { batch, createSignal, type JSX, Match, onMount, Show, Switch } from "solid-js"
import { CONTROLS_STYLE, NOTE_STYLE, type Option, Select } from "./controls.tsx"
import type { ScenarioDef, TriggerMeta } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "layout-id-switch"

/** Where the twins sit. */
type Container = "page" | "shared" | "split"

/** The container choices, in the order the select lists them. */
const CONTAINERS: ReadonlyArray<Option<Container>> = [
  { value: "page", label: "page (no container)" },
  { value: "shared", label: "shared: one layoutScroll box" },
  { value: "split", label: "split: two layoutScroll boxes" },
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
  onMount(() => {
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

  const choose = (next: Container): void => {
    batch(() => {
      setShowB(false)
      setContainer(next)
    })
  }

  /** The live container scroll, read in the click, before the swap. */
  const meta = (): TriggerMeta | undefined => {
    switch (container()) {
      case "page":
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
        </Switch>
      </div>
      <button type="button" class="btn" data-action="run" onClick={run}>
        Run
      </button>
      <p style={NOTE_STYLE}>
        shared/split put the twins in layoutScroll boxes (scroll them by hand before Run). split is the case where
        folding each twin with its own container's scroll would start the enterer 80px off.
      </p>
    </div>
  )
}

/**
 * Scenario 7, layoutId switch: a click swaps two `layoutId` twins under `<Show>` —
 * on the page, in one `layoutScroll` box, or across two — and the new twin's mount
 * schedules the measure pass. Expected to be safe.
 */
export const s7: ScenarioDef = {
  id: ID,
  index: 7,
  title: "layoutId switch",
  mechanism:
    "The Run click swaps two layoutId twins under <Show> (on the page, or inside layoutScroll boxes); the new twin's mount registers its projection node, which schedules the measure.",
  prediction: "safe",
  rationale:
    "The <Show> swap runs synchronously in the click task: Solid disposes the leaver, whose projection node captures " +
    "its box in the Root frame and holds it for the rest of the task, then the new twin's mount effect registers its " +
    "projection node, takes that seed, and register() calls scheduleMeasure. The gate rAF is therefore requested " +
    "from the click task and lands in the same frame's rAF, before paint, where the first measure rebases the seed " +
    "into the new twin's frame and FLIPs it from the leaver's painted box.",
  View,
}
