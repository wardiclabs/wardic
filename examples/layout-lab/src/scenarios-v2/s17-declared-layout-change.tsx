/**
 * Scenario 17 on the Solid 2 binding (#209 PR 5b): Solid 1's (`../scenarios/s17-declared-layout-change.tsx`), its
 * writes as a Solid 2 app makes them.
 *
 * Scenario 17, a Declared layout change (#4, ADR-0038): `animateLayout` around layout changes no
 * trigger sees, beside the same changes made plainly.
 *
 * - **The row.** Three `layout` items keyed by `<For>`, with no `layoutDependency` but a counter
 *   only Shuffle, triggered bumps. Each shuffle rotates them, so A moves 100 px or more sideways.
 *   - **Shuffle** declares it (`animateLayout(() => setItems(...))`).
 *   - **Shuffle, triggered** bumps the counter with it, as a plain `layoutDependency` change.
 *   - **Shuffle, untriggered** just writes it: moving the DOM nodes resizes nothing, so no trigger sees it.
 * - **The panel.** A plain element above it (no node), which Grow panel toggles, 30 px, with no
 *   trigger: everything below moves and no Measurement does, until a pass or a call. The stage's
 *   height is fixed, so the page's size doesn't change, and no page-size refresh (#261) sees it.
 * - **The pair** (Motion's `parallel-calls-intersecting`). Two calls in one click: one grows A,
 *   which pushes B down; the other shifts B right. B is watched for that run.
 * - **The callbacks**, as Solid 2 hears them (#257, ADR-0046): every tile counts its layout
 *   animations' starts and landings for the run, through `wardRef` and `card.each("layoutStart")` /
 *   `card.each("layoutComplete")`, and a declared run awaits `animateLayout`'s promise (Solid 1's
 *   card uses the props and `onSettled`, ADR-0039). The `callbacks` line under the buttons shows
 *   them, judged on as many completes as starts and the settling after the last complete, and each
 *   settling is noted on the timeline panel. A saved log keeps runs only, so neither is in it.
 *   Shuffle and Two calls wait for their change to settle before they can run again.
 *
 * @module
 */
import { useAnimateLayout, type Ward, wardic } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { ScenarioDef } from "../scenarios/types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "declared-layout-change"

/** The panel, the row and the pair, stacked. */
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "420px", "--stage-h": "260px" }
const COLUMN: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "10px", padding: "10px" }
const ROW: JSX.CSSProperties = { display: "flex", gap: "20px" }
const BUTTONS: JSX.CSSProperties = { display: "flex", "flex-wrap": "wrap", gap: "6px", "margin-top": "6px" }
const CALLBACKS: JSX.CSSProperties = { display: "flex", gap: "8px", "align-items": "baseline", "margin-top": "6px" }
/** The line's whole text is the point, so it wraps (as #43's `announced` line does). */
const WRAPS: JSX.CSSProperties = { "white-space": "normal" }

/** One run's layout animation callbacks (#191): counted from its trigger. */
interface Tally {
  readonly source: string
  readonly at: number
  readonly starts: number
  readonly completes: number
  readonly lastCompleteAt: number | undefined
  /** When its `animateLayout` resolved, for a declared run; `undefined` until then, or for any other run. */
  readonly settledAt: number | undefined
  readonly declared: boolean
}

/** The `callbacks` line's text and verdict: as many completes as starts, settled after the last. */
const callbacksLine = (t: Tally): { readonly text: string; readonly ok: boolean | undefined } => {
  const ms = (at: number | undefined): string => (at === undefined ? "–" : `${Math.round(at - t.at)} ms`)
  const settled = t.declared ? `settled ${ms(t.settledAt)}` : "nothing to await (undeclared)"
  const text = `${t.source}: ${t.starts} start${t.starts === 1 ? "" : "s"} · ${t.completes} complete${t.completes === 1 ? "" : "s"} · ${settled}`
  if (!t.declared) return { text, ok: undefined }
  if (t.settledAt === undefined) return { text, ok: undefined }
  const after = t.lastCompleteAt === undefined || t.settledAt >= t.lastCompleteAt
  return { text, ok: t.starts > 0 && t.completes === t.starts && after }
}

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
  const [tally, setTally] = createSignal<Tally | undefined>(undefined)
  const [settling, setSettling] = createSignal(false)
  /** A new run's tally, from its trigger. */
  const count = (source: string, declared: boolean): void =>
    void setTally({ source, at: performance.now(), starts: 0, completes: 0, lastCompleteAt: undefined, settledAt: undefined, declared })
  const onStart = (): void => void setTally((t) => (t === undefined ? t : { ...t, starts: t.starts + 1 }))
  const onComplete = (): void =>
    void setTally((t) => (t === undefined ? t : { ...t, completes: t.completes + 1, lastCompleteAt: performance.now() }))
  /** A declared run settled: noted on the timeline, and the declared buttons free again. */
  const settled = (): void => {
    setTally((t) => (t === undefined ? t : { ...t, settledAt: performance.now() }))
    setSettling(false)
    const t = tally()
    if (t !== undefined) props.ctx.mark(`settled: ${t.starts} starts, ${t.completes} completes`)
  }
  /**
   * A tile's ward: each of its layout animations' starts and landings counted, read as async values
   * and an effect on each. They carry no value, so `equals: false`: each one is a change.
   */
  const hear = (card: Ward): void => {
    const started = createMemo(() => card.each("layoutStart"), { equals: false })
    const landed = createMemo(() => card.each("layoutComplete"), { equals: false })
    createEffect(started, () => {
      onStart()
    })
    createEffect(landed, () => {
      onComplete()
    })
  }

  /** The row, one place on: A moves 100 px or more each time. */
  const rotated = (): Array<string> => [...items().slice(1), items()[0]!]
  const watchRow = (source: string): void => {
    if (rowA !== undefined) props.ctx.watch(rowA)
    props.ctx.markTrigger(source)
  }

  const shuffle = async (): Promise<void> => {
    watchRow("declared")
    count("Shuffle", true)
    setSettling(true)
    await animateLayout(() => setItems(rotated()))
    settled()
  }
  const shuffleTriggered = (): void => {
    watchRow("layoutDependency")
    count("Shuffle, triggered", false)
    // Solid 2 applies both at its flush.
    setItems(rotated())
    setDep((d) => d + 1)
  }
  const shuffleUntriggered = (): void => {
    watchRow("no trigger")
    count("Shuffle, untriggered", false)
    setItems(rotated())
  }
  const growPanel = (): void => {
    props.ctx.mark("grow panel (no trigger)")
    setTall((t) => !t)
  }
  const twoCalls = async (): Promise<void> => {
    if (pairB !== undefined) props.ctx.watch(pairB)
    props.ctx.markTrigger("two calls")
    count("Two calls", true)
    setSettling(true)
    // The two calls share their task's pass, so they resolve together.
    await Promise.all([animateLayout(() => setGrown((g) => !g)), animateLayout(() => setShifted((s) => !s))])
    settled()
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
                  wardRef={hear}
                  style={tile(ACCENT)}
                >
                  {value}
                </wardic.div>
              )}
            </For>
          </div>
          <wardic.div data-pair="grow" layout wardRef={hear} style={tile(ALT, { height: grown() ? "80px" : "40px" })}>
            grow
          </wardic.div>
          <wardic.div
            ref={(el: HTMLElement) => (pairB = el)}
            data-pair="shift"
            layout
            wardRef={hear}
            style={tile(ALT, { "margin-left": shifted() ? "120px" : "0px" })}
          >
            shift
          </wardic.div>
        </div>
      </div>
      <div style={BUTTONS}>
        <button type="button" class="btn" data-action="run" disabled={settling()} onClick={() => void shuffle()}>
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
        <button type="button" class="btn secondary small" data-action="two-calls" disabled={settling()} onClick={() => void twoCalls()}>
          Two calls
        </button>
      </div>
      <div style={CALLBACKS} data-callbacks>
        <span class="result-label">callbacks</span>
        <Show when={tally()} fallback={<span class="result-value">–</span>}>
          {(t) => {
            const line = () => callbacksLine(t())
            return (
              <span class="result-value" style={WRAPS}>
                {line().text} {line().ok === undefined ? "" : line().ok ? "✓" : "✗"}
              </span>
            )
          }}
        </Show>
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
    "Solid 2 applies the callback's writes at its flush, queued at the write, ahead of the Measure pass, and a " +
    "plain Shuffle's at its flush in the click's task. " +
    "animateLayout measures every node at the call, before its callback runs, and the Measure pass at the end of the " +
    "click's task animates what moved from there (ADR-0038): Shuffle is clean, held 0, after Grow panel too. Shuffle, " +
    "triggered is clean on fresh Measurements; after Grow panel it reads wrong-origin, since its pass animates from the Measurement " +
    "taken before the panel grew, 30 px off where A was painted (the gap #4 closes; the panel grows inside the stage's " +
    "fixed height, so the page's size doesn't change and no page-size refresh reads it, #261). Shuffle, untriggered snaps: " +
    "moving the items' DOM nodes resizes nothing, so no trigger sees it. Two calls is clean: the shifted box animates " +
    "from before the grown one pushed it, as both calls share the first one's Measurements (Motion's " +
    "parallel-calls-intersecting). The callbacks line counts each run's layout animation starts and " +
    "landings, heard through each tile's card.each(\"layoutStart\" | \"layoutComplete\"), and when a declared run's " +
    "animateLayout promise resolved (#257, ADR-0046): as many completes as starts, settled after the last; Shuffle " +
    "and Two calls wait for it.",
  View,
}
