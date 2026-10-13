/**
 * Scenario 15: base values (#47, ADR-0022). A board of six cells, each a key that no
 * `initial` or `animate` gives a value, driven by hand:
 *
 * - **hover scale**: `whileHover: { scale: 1.5 }`. Starts at 1, back at 1.
 * - **class opacity**: a stylesheet's `opacity: 0.5`, `whileHover: { opacity: 1 }`. Starts
 *   and ends at 0.5, the computed style read at the first hover.
 * - **style opacity**: `style={{ opacity }}` at 0.5, `whileHover: { opacity: 1 }`; the
 *   button flips the style between 0.5 and 0.8 at rest, and the change shows at once.
 * - **tap scale**: `whileTap: { scale: 0.8 }`. Starts at 1, back at 1.
 * - **fade, no initial**: `animate: { opacity: 0.5 }` and no `initial`; Remount mounts it
 *   again. It fades down from its own 1, never up from 0.
 * - **exit**: a stylesheet's `opacity: 0.5` and `exit: { opacity: 0 }` under
 *   `<AnimatePresence>`; the button removes it (or brings it back). It fades out from 0.5.
 *
 * And three cells for `initial={false}` (#134), each starting at its `animate` with no mount
 * animation; Remount no-mount mounts the three again:
 *
 * - **no mount: initial false**: `initial={false} animate={{ opacity: 0.5 }}`. Starts at 0.5
 *   and never moves (the fade cell beside it fades from its own 1).
 * - **no mount: variant child**: a parent with `initial={false} animate="half"` and a Variant
 *   child whose `half` is `opacity: 0.5`. The child takes `false` from it and starts at 0.5.
 * - **no mount: presence**: `<AnimatePresence initial={false}>` around a child with
 *   `initial={{ opacity: 0 }} animate={{ opacity: 0.5 }}`. Remounted, it starts at 0.5; Leave
 *   then Enter brings it back as a later entry, which fades in from 0 (Motion's rule).
 *
 * And two cells for a camelCase custom property (#151), each with its opacity set to
 * `var(--brandLevel)`, its own `--brandLevel` 1 in `style`, and `animate: { "--brandLevel": 0.5 }`;
 * Remount custom property mounts both again:
 *
 * - **custom property: div**: on a `wardic.div`.
 * - **custom property: svg**: on a `wardic.circle` in an `<svg>`.
 *
 * Each fades from its own 1 to 0.5. Before #151 the animation wrote `--brand-level` (an
 * attribute on the circle) and removed the element's own `--brandLevel`, so its opacity
 * stayed at 1.
 *
 * Each gesture is one board run, judged by `lab/base-values-board.ts` (`start`, `end`) and
 * saved under `boardRuns`. Before #47's fix every scale grew from 0 and stayed, every
 * opacity started at 0, the fade rose from 0 and the exit vanished at once.
 *
 * @module
 */
import { AnimatePresence, wardic, type WardicValues } from "@wardic/solid"
import { createSignal, For, type JSX, onCleanup, Show } from "solid-js"
import type { BoardRunKind } from "../lab/base-values-board.ts"
import type { ScenarioContext, ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "base-values"

// One sheet, found again by its id: a hot reload runs this module again.
const SHEET_ID = "lab-s15-base-values"
const sheet = document.getElementById(SHEET_ID) ?? Object.assign(document.createElement("style"), { id: SHEET_ID })
sheet.textContent = ".bv-half { opacity: 0.5; }"
document.head.append(sheet)

const GRID: JSX.CSSProperties = {
  display: "grid",
  "grid-template-columns": "repeat(3, 1fr)",
  "grid-template-rows": "repeat(4, 1fr)",
  width: "100%",
  height: "100%",
}
const CELL: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center", gap: "4px" }
const BOX: JSX.CSSProperties = { width: "44px", height: "32px", background: "var(--lab-accent, rgb(0, 102, 204))", "border-radius": "4px" }
const LABEL: JSX.CSSProperties = { "font-size": "10px", opacity: 0.8 }
/** A box whose opacity reads the custom property `--brandLevel`, its own value 1 (#151). */
const LEVEL = { ...BOX, opacity: "var(--brandLevel)", "--brandLevel": "1" } as JSX.CSSProperties
/** The circle's: the same, with the box's colour as its fill. */
const LEVEL_SVG = { fill: "var(--lab-accent, rgb(0, 102, 204))", opacity: "var(--brandLevel)", "--brandLevel": "1" } as JSX.CSSProperties
/** Where the custom property cells go. */
const HALF_LEVEL = { "--brandLevel": 0.5 } as WardicValues
const BUTTONS: JSX.CSSProperties = { display: "flex", gap: "6px", "margin-top": "6px" }

/** The painted uniform scale: the computed transform matrix's x-axis length, 1 for none. */
const scaleOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 1
  const v = /\(([^)]+)\)/.exec(t)?.[1]?.split(",").map(Number)
  return v === undefined ? Number.NaN : Math.hypot(v[0]!, v[1]!)
}
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** How long a run may take to stand still after its gesture ends, in ms. */
const SETTLE_MS = 2000
/** How many frames in a row the value must stand still to end a run. */
const STILL_FRAMES = 4

/** The run the board's recorder is building for one cell. */
interface Recording {
  readonly cell: string
  readonly kind: BoardRunKind
  readonly base: number
  readonly target: number
  readonly before: number
  readonly startedAt: number
  readonly values: Array<number>
  /** Where `during` ends (the gesture's end), once it has. */
  split: number | undefined
  endAt: number | undefined
}

/**
 * Sample `read()` just after every painted frame (a `MessageChannel` message posted from
 * each rAF runs after that frame's rendering, as the lab's sampler reads) from `start()`
 * until the gesture has ended and the value stood still, then record the run.
 */
const makeRecorder = (ctx: ScenarioContext) => {
  // The runs still sampling, closed unrecorded when the View goes.
  const sampling = new Set<MessageChannel>()
  const start = (
    cell: string,
    kind: BoardRunKind,
    read: () => number | undefined,
    base: number,
    target: number,
    before: number,
  ): { readonly end: () => void } => {
    const rec: Recording = { cell, kind, base, target, before, startedAt: performance.now(), values: [], split: undefined, endAt: undefined }
    const channel = new MessageChannel()
    sampling.add(channel)
    // A mount or a style change has no end event: every frame until it stands still is `during`.
    const open = kind === "mount" || kind === "style change"
    const finish = (): void => {
      channel.port1.close()
      sampling.delete(channel)
      const split = open ? rec.values.length : (rec.split ?? rec.values.length)
      ctx.recordBoardRun({
        cell,
        kind,
        base,
        target,
        before,
        during: rec.values.slice(0, split),
        after: rec.values.slice(split),
        startedAt: rec.startedAt,
        endedAt: performance.now(),
      })
    }
    channel.port1.onmessage = () => {
      const value = read()
      // The node went (an exit): the run ends with it.
      if (value === undefined) {
        rec.split ??= rec.values.length
        finish()
        return
      }
      rec.values.push(value)
      if (rec.split !== undefined) {
        const tail = rec.values.slice(-STILL_FRAMES)
        const still = tail.length === STILL_FRAMES && tail.every((v) => Math.abs(v - tail[0]!) < 0.0005)
        if (still || performance.now() - (rec.endAt ?? 0) > SETTLE_MS) {
          finish()
          return
        }
      }
      requestAnimationFrame(() => channel.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => channel.port2.postMessage(undefined))
    return {
      end: () => {
        if (rec.split !== undefined) return
        rec.split = rec.values.length
        rec.endAt = performance.now()
      },
    }
  }
  /** Stop every run still sampling, unrecorded. */
  const dispose = (): void => {
    for (const channel of sampling) channel.port1.close()
    sampling.clear()
  }
  return { start, dispose }
}

/** The scenario View. */
const View: ScenarioDef["View"] = (props) => {
  const recorder = makeRecorder(props.ctx)
  const [styleOpacity, setStyleOpacity] = createSignal(0.5)
  const [fadeKey, setFadeKey] = createSignal(0)
  const [shown, setShown] = createSignal(true)
  // The three `initial={false}` cells (#134): remounted together; the presence child's later entry.
  const [noMountKey, setNoMountKey] = createSignal(0)
  const [presenceShown, setPresenceShown] = createSignal(true)
  let laterEntry = false
  // The two custom property cells (#151): remounted together.
  const [customKey, setCustomKey] = createSignal(0)

  // A press ends at a release anywhere, as Wardic's press does (ADR-0019): a `pointerup`
  // outside the cell, or a `pointercancel`, ends its run too.
  const releases = new Set<() => void>()
  const onRelease = (): void => {
    for (const end of releases) end()
  }
  window.addEventListener("pointerup", onRelease, { capture: true, passive: true })
  window.addEventListener("pointercancel", onRelease, { capture: true, passive: true })
  onCleanup(() => {
    window.removeEventListener("pointerup", onRelease, true)
    window.removeEventListener("pointercancel", onRelease, true)
    recorder.dispose()
  })

  /** Wire a hover (enter, then leave) or press (down, then a release anywhere) gesture on `el`. */
  const gestureOn = (
    el: HTMLElement,
    cell: string,
    read: (el: Element) => number,
    base: () => number,
    target: number,
    gesture: "hover" | "press",
  ): void => {
    let run: { readonly end: () => void } | undefined
    const begin = (): void => {
      run?.end()
      run = recorder.start(cell, "gesture", () => read(el), base(), target, read(el))
    }
    const end = (): void => {
      run?.end()
      run = undefined
    }
    if (gesture === "hover") {
      el.addEventListener("pointerenter", begin, { passive: true })
      el.addEventListener("pointerleave", end, { passive: true })
    } else {
      el.addEventListener("pointerdown", begin, { passive: true })
      releases.add(end)
    }
  }

  const flipStyle = (): void => {
    const el = document.querySelector<HTMLElement>(`[data-scenario="${ID}"] [data-cell="style"]`)
    const before = el === null ? Number.NaN : opacityOf(el)
    const next = styleOpacity() === 0.5 ? 0.8 : 0.5
    setStyleOpacity(next)
    if (el !== null) recorder.start("style opacity", "style change", () => opacityOf(el), next, next, before).end()
  }

  const remount = (): void => {
    setFadeKey((k) => k + 1)
  }

  const remountNoMount = (): void => {
    laterEntry = false
    setPresenceShown(true)
    setNoMountKey((k) => k + 1)
  }

  // The presence child leaves (its exit), then comes back after the presence's first render.
  const togglePresence = (): void => {
    laterEntry = true
    setPresenceShown((s) => !s)
  }

  let exitEl: HTMLElement | undefined
  const toggleExit = (): void => {
    if (shown() && exitEl !== undefined) {
      const leaving = exitEl
      recorder.start("exit", "exit", () => (leaving.isConnected ? opacityOf(leaving) : undefined), 0.5, 0, opacityOf(leaving))
    }
    setShown((s) => !s)
  }

  return (
    <div data-scenario={ID}>
      <div class="stage">
        <div style={GRID}>
          <div style={CELL}>
            <wardic.div
              data-cell="hover"
              ref={(el: HTMLElement) => gestureOn(el, "hover scale", scaleOf, () => 1, 1.5, "hover")}
              style={BOX}
              whileHover={{ scale: 1.5 }}
            />
            <span style={LABEL}>hover scale</span>
          </div>
          <div style={CELL}>
            <wardic.div
              data-cell="class"
              class="bv-half"
              ref={(el: HTMLElement) => gestureOn(el, "class opacity", opacityOf, () => 0.5, 1, "hover")}
              style={BOX}
              whileHover={{ opacity: 1 }}
            />
            <span style={LABEL}>class opacity</span>
          </div>
          <div style={CELL}>
            <wardic.div
              data-cell="style"
              ref={(el: HTMLElement) => gestureOn(el, "style opacity", opacityOf, styleOpacity, 1, "hover")}
              style={{ ...BOX, opacity: styleOpacity() }}
              whileHover={{ opacity: 1 }}
            />
            <span style={LABEL}>style opacity {styleOpacity()}</span>
          </div>
          <div style={CELL}>
            <wardic.div
              data-cell="tap"
              ref={(el: HTMLElement) => gestureOn(el, "tap scale", scaleOf, () => 1, 0.8, "press")}
              style={BOX}
              whileTap={{ scale: 0.8 }}
            />
            <span style={LABEL}>tap scale</span>
          </div>
          <div style={CELL}>
            <For each={[fadeKey()]}>
              {() => (
                <wardic.div
                  data-cell="fade"
                  ref={(el: HTMLElement) => recorder.start("fade, no initial", "mount", () => opacityOf(el), 1, 0.5, Number.NaN).end()}
                  style={BOX}
                  animate={{ opacity: 0.5 }}
                />
              )}
            </For>
            <span style={LABEL}>fade, no initial</span>
          </div>
          <div style={CELL}>
            <AnimatePresence>
              <Show when={shown()}>
                <wardic.div data-cell="exit" class="bv-half" ref={(el: HTMLElement) => (exitEl = el)} style={BOX} exit={{ opacity: 0 }} />
              </Show>
            </AnimatePresence>
            <span style={LABEL}>exit</span>
          </div>
          <For each={[noMountKey()]}>
            {() => (
              <>
                <div style={CELL}>
                  <wardic.div
                    data-cell="no-mount"
                    ref={(el: HTMLElement) => recorder.start("no mount: initial false", "mount", () => opacityOf(el), 0.5, 0.5, Number.NaN).end()}
                    style={BOX}
                    initial={false}
                    animate={{ opacity: 0.5 }}
                  />
                  <span style={LABEL}>no mount: initial false</span>
                </div>
                <div style={CELL}>
                  <wardic.div initial={false} animate="half" variants={{ half: {} }}>
                    <wardic.div
                      data-cell="no-mount-child"
                      ref={(el: HTMLElement) => recorder.start("no mount: variant child", "mount", () => opacityOf(el), 0.5, 0.5, Number.NaN).end()}
                      style={BOX}
                      variants={{ half: { opacity: 0.5 } }}
                    />
                  </wardic.div>
                  <span style={LABEL}>no mount: variant child</span>
                </div>
                <div style={CELL}>
                  <AnimatePresence initial={false}>
                    <Show when={presenceShown()}>
                      <wardic.div
                        data-cell="no-mount-presence"
                        ref={(el: HTMLElement) =>
                          laterEntry
                            ? recorder.start("presence: later entry", "mount", () => opacityOf(el), 0, 0.5, Number.NaN).end()
                            : recorder.start("no mount: presence", "mount", () => opacityOf(el), 0.5, 0.5, Number.NaN).end()
                        }
                        style={BOX}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.5 }}
                        exit={{ opacity: 0 }}
                      />
                    </Show>
                  </AnimatePresence>
                  <span style={LABEL}>no mount: presence</span>
                </div>
              </>
            )}
          </For>
          <For each={[customKey()]}>
            {() => (
              <>
                <div style={CELL}>
                  <wardic.div
                    data-cell="custom-div"
                    ref={(el: HTMLElement) => recorder.start("custom property: div", "mount", () => opacityOf(el), 1, 0.5, Number.NaN).end()}
                    style={LEVEL}
                    animate={HALF_LEVEL}
                  />
                  <span style={LABEL}>custom property: div</span>
                </div>
                <div style={CELL}>
                  <svg width="44" height="32">
                    <wardic.circle
                      data-cell="custom-svg"
                      ref={(el: SVGElement) => recorder.start("custom property: svg", "mount", () => opacityOf(el), 1, 0.5, Number.NaN).end()}
                      r={14}
                      cx={22}
                      cy={16}
                      style={LEVEL_SVG}
                      animate={HALF_LEVEL}
                    />
                  </svg>
                  <span style={LABEL}>custom property: svg</span>
                </div>
              </>
            )}
          </For>
        </div>
      </div>
      <div style={BUTTONS}>
        <button type="button" class="btn secondary small" data-action="style" onClick={flipStyle}>
          Style 0.5 ↔ 0.8
        </button>
        <button type="button" class="btn secondary small" data-action="remount" onClick={remount}>
          Remount fade
        </button>
        <button type="button" class="btn secondary small" data-action="exit" onClick={toggleExit}>
          {shown() ? "Exit" : "Enter"}
        </button>
        <button type="button" class="btn secondary small" data-action="remount-no-mount" onClick={remountNoMount}>
          Remount no-mount
        </button>
        <button type="button" class="btn secondary small" data-action="presence" onClick={togglePresence}>
          {presenceShown() ? "Leave" : "Enter"} presence
        </button>
        <button type="button" class="btn secondary small" data-action="remount-custom" onClick={() => setCustomKey((k) => k + 1)}>
          Remount custom property
        </button>
      </div>
    </div>
  )
}

/**
 * Scenario 15, base values (#47): six cells whose key no `initial` or `animate` sets, three
 * `initial={false}` cells (#134) and two custom property cells (#151), each judged per run on
 * where it starts and where it ends.
 */
export const s15: ScenarioDef = {
  id: ID,
  index: 15,
  kind: "board",
  title: "base values (a key no initial sets)",
  mechanism:
    "Hover, press, Remount and Exit drive keys only a gesture, an initial-less animate or an exit sets; the third row is initial={false} (Remount no-mount, Leave/Enter presence); the fourth animates a camelCase custom property its opacity reads (Remount custom property). Each run is judged on its start and its end.",
  prediction: "safe",
  rationale:
    "A key with no value starts from its style value, else its Own value (1 for a scale, the computed style " +
    "otherwise, read once at first need), and returns to its initial value, style value or Own value (ADR-0022). " +
    "Motion 13.5.0 does the same in Chromium and Firefox (docs/research/base-values.md). With initial={false} an element, " +
    "a Variant child and an AnimatePresence initial={false}'s first child start at their animate and don't move; a later " +
    "entry animates in (#134, Motion's). A custom property keeps its name and is a style property on SVG too, so " +
    "var(--brandLevel) follows it from the element's own 1 (#151, Motion's).",
  View,
}
