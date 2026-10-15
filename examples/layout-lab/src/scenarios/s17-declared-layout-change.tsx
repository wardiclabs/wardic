/**
 * Scenario 17, a Declared layout change (#4, ADR-0038): `animateLayout` around layout changes no
 * trigger sees, beside the same changes made plainly.
 *
 * - **The row.** Three `layout` items keyed by `<For>`, with no `layoutDependency` but a counter
 *   only Shuffle, triggered bumps. Each shuffle rotates them, so A moves 100 px or more sideways.
 *   - **Shuffle** declares it (`animateLayout(() => setItems(...))`).
 *   - **Shuffle, triggered** bumps the counter with it, as a plain `layoutDependency` change.
 *   - **Shuffle, untriggered** just writes it: moving the DOM nodes resizes nothing, so no trigger sees it.
 * - **The panel.** A plain element above it (no node), which Grow panel toggles, 30 px, with no
 *   trigger: everything below moves and no Measurement does, until a pass or a call.
 * - **The pair** (Motion's `parallel-calls-intersecting`). Two calls in one click: one grows A,
 *   which pushes B down; the other shifts B right. B is watched for that run.
 *
 * @module
 */
import { useAnimateLayout, wardic } from "@wardic/solid"
import { batch, createSignal, For, type JSX } from "solid-js"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "declared-layout-change"

/** The panel, the row and the pair, stacked. */
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "420px", "--stage-h": "260px" }
const COLUMN: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "10px", padding: "10px" }
const ROW: JSX.CSSProperties = { display: "flex", gap: "20px" }
const BUTTONS: JSX.CSSProperties = { display: "flex", "flex-wrap": "wrap", gap: "6px", "margin-top": "6px" }

const ACCENT = "var(--lab-accent, rgb(0, 102, 204))"
const ALT = "rgb(204, 85, 0)"

/** The plain panel: no node, so its height moves what's below it unseen. */
const panelStyle = (tall: boolean): JSX.CSSProperties => ({
  width: "400px",
  height: tall ? "30px" : "0px",
  background: "repeating-linear-gradient(45deg, #c9ced6 0 6px, transparent 6px 12px)",
  "border-radius": "4px",
})

/** An 80 × 40 tile, labelled. */
const tile = (background: string, extra: JSX.CSSProperties = {}): JSX.CSSProperties => ({
  width: "80px",
  height: "40px",
  background,
  "border-radius": "6px",
  color: "white",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "font-size": "14px",
  ...extra,
})

/** The scenario View: the panel, the row, the pair, and the buttons. */
const View: ScenarioDef["View"] = (props) => {
  const animateLayout = useAnimateLayout()
  const [items, setItems] = createSignal(["A", "B", "C"])
  const [dep, setDep] = createSignal(0)
  const [tall, setTall] = createSignal(false)
  const [grown, setGrown] = createSignal(false)
  const [shifted, setShifted] = createSignal(false)
  let rowA: HTMLElement | undefined
  let pairB: HTMLElement | undefined

  /** The row, one place on: A moves 100 px or more each time. */
  const rotated = (): Array<string> => [...items().slice(1), items()[0]!]
  const watchRow = (source: string): void => {
    if (rowA !== undefined) props.ctx.watch(rowA)
    props.ctx.markTrigger(source)
  }

  const shuffle = (): void => {
    watchRow("declared")
    animateLayout(() => setItems(rotated()))
  }
  const shuffleTriggered = (): void => {
    watchRow("layoutDependency")
    batch(() => {
      setItems(rotated())
      setDep((d) => d + 1)
    })
  }
  const shuffleUntriggered = (): void => {
    watchRow("no trigger")
    setItems(rotated())
  }
  const growPanel = (): void => {
    props.ctx.mark("grow panel (no trigger)")
    setTall((t) => !t)
  }
  const twoCalls = (): void => {
    if (pairB !== undefined) props.ctx.watch(pairB)
    props.ctx.markTrigger("two calls")
    animateLayout(() => setGrown((g) => !g))
    animateLayout(() => setShifted((s) => !s))
  }

  return (
    <div data-scenario={ID}>
      <div class="stage" style={STAGE_STYLE}>
        <div style={COLUMN}>
          <div data-panel style={panelStyle(tall())} />
          <div style={ROW}>
            <For each={items()}>
              {(value) => (
                <wardic.div
                  ref={(el: HTMLElement) => {
                    if (value !== "A") return
                    rowA = el
                    props.ctx.watch(el)
                  }}
                  data-item={value}
                  layout
                  layoutDependency={dep()}
                  style={tile(ACCENT)}
                >
                  {value}
                </wardic.div>
              )}
            </For>
          </div>
          <wardic.div data-pair="grow" layout style={tile(ALT, { height: grown() ? "80px" : "40px" })}>
            grow
          </wardic.div>
          <wardic.div ref={(el: HTMLElement) => (pairB = el)} data-pair="shift" layout style={tile(ALT, { "margin-left": shifted() ? "120px" : "0px" })}>
            shift
          </wardic.div>
        </div>
      </div>
      <div style={BUTTONS}>
        <button type="button" class="btn" data-action="run" onClick={shuffle}>
          Shuffle
        </button>
        <button type="button" class="btn secondary small" data-action="shuffle-triggered" onClick={shuffleTriggered}>
          Shuffle, triggered
        </button>
        <button type="button" class="btn secondary small" data-action="shuffle-untriggered" onClick={shuffleUntriggered}>
          Shuffle, untriggered
        </button>
        <button type="button" class="btn secondary small" data-action="grow-panel" onClick={growPanel}>
          Grow panel
        </button>
        <button type="button" class="btn secondary small" data-action="two-calls" onClick={twoCalls}>
          Two calls
        </button>
      </div>
    </div>
  )
}

/**
 * Scenario 17, a Declared layout change (#4): `animateLayout` animates a keyed reorder no trigger
 * sees, from where the item was even after an unseen change, and two calls in one click compose.
 */
export const s17: ScenarioDef = {
  id: ID,
  index: 17,
  title: "animateLayout (a Declared layout change)",
  mechanism:
    "Shuffle rotates a keyed row of layout items inside animateLayout; Shuffle, triggered rotates it with a layoutDependency bump; Shuffle, untriggered just rotates it. Grow panel moves everything below a plain panel with no trigger. Two calls grows one box and shifts the box it pushes, in two animateLayout calls in one click.",
  prediction: "safe",
  expectedHeld: 0,
  rationale:
    "animateLayout measures every node at the call, before its callback runs, and the Measure pass at the end of the " +
    "click's task animates what moved from there (ADR-0038): Shuffle is clean, held 0, after Grow panel too. Shuffle, " +
    "triggered is clean on fresh Measurements; after Grow panel it reads wrong-origin, since its pass animates from the Measurement " +
    "taken before the panel grew, 30 px off where A was painted (the gap #4 closes). Shuffle, untriggered snaps: " +
    "moving the items' DOM nodes resizes nothing, so no trigger sees it. Two calls is clean: the shifted box animates " +
    "from before the grown one pushed it, as both calls share the first one's Measurements (Motion's " +
    "parallel-calls-intersecting).",
  View,
}
