/**
 * Scenario 13: the release, the pointer lag, and a slot that changes under the drag in
 * the other two ways (issue #26, ADR-0016 *Amendment (#26)*).
 *
 * The draggable `layout` item D, holding a `layout` child C1, sits inside a `layout`
 * parent P. While D is held:
 *
 * - **Z** resizes D's own slot (80px ↔ 120px tall). The drag target takes the new size
 *   about its centre, so D paints its new size under the pointer (A1c), and its child
 *   stays on it.
 * - **P** moves P, and with it D's slot, 60px right as a FLIP. The Measure pass seeds P
 *   and drag-blocks D and C1; D stays under the pointer while P animates under it.
 *
 * Z and P also work while D flies back after the release. Since ADR-0016's *Amendment
 * (velocity family)* the release is an offset springing to zero on top of D's layout, so
 * a slot move then animates under it and the flight keeps its speed (#28: before, the
 * whole flight restarted from rest). At rest, they give D a layout animation of its own
 * (Z a resize, P a move with its parent): grab D while it runs, and the flight goes on
 * under the pointer, as Motion's does, with no jump (#30: before, D jumped to its slot
 * plus the pointer's offset). The card then judges the drag from where that flight lands
 * under the pointer (the recorder's `flyingAtPress`). The **momentum** box (on by default, as
 * `dragMomentum`) gives the release the pointer's velocity over its last 100 ms: a flick
 * carries D on. The **twin** box gives D a `layoutId` twin parked in the stage's corner:
 * D is then a Lead with a hidden Follower, and keeps its opacity through the release
 * (#34: before, it dropped to 0.03 and the twin showed through). Both boxes remount D, so
 * a twin's mount crossfades D in from the corner, which is the one crossfade expected.
 *
 * The **free box** F (#139), bottom left, is a plain `drag` with no `layout`: its release is
 * a Fling from the pointer's velocity over its last 100 ms, the release point counted
 * (ADR-0004, *Amendment (#139)*). Let go while moving, it carries on; let go still, or after
 * a pause, it stays where it was let go; with the momentum box off it always stays. Its
 * runs show the card's `fling` and `rests` lines, and its slot lines aren't judged: a free
 * item rests where it lands. A flick can carry it out of the stage: **Put the free box back**
 * remounts it. (Before #139 its 30 ms window read no velocity for moves more than 30 ms
 * apart, so a flick often stopped dead.)
 *
 * Since #140 every release runs on the drag transition, Motion's inertia (ADR-0016,
 * *Amendment (#140)*): a Fling glides on for seconds, easing out over 0.75 s (before, a decay
 * that stopped in under 2 s, a third as far). The **bounds** box gives F `dragConstraints`,
 * drawn dashed: x 0 to 200, y −150 to 0. The drag holds it within them, pulled back past an
 * edge by Motion's default `dragElastic`, 0.35 (the card's `under pointer` expects that), and a
 * Fling that would cross an edge springs back to it on the 200 / 40 bounce and rests there:
 * the `stays in bounds` line (before #140 it coasted on past the edge and rested there). The
 * **grid** box gives F a `modifyTarget` that rests a release on a 50 px grid, its dots where
 * F's top-left corner can rest; the `rests` line judges it. Both remount F.
 *
 * The card's release lines are the point of the plain runs: a release from a
 * pointerup moves on its first painted frame, and it always ends on the slot, even when
 * you let go back where you grabbed while still moving (the release that used to stay
 * stuck off its slot). The "lose the next release" toggle (L while D is held, or its
 * checkbox) swallows the press's pointerup, for the card's `gesture ends` line (#31,
 * ADR-0019).
 *
 * @module
 */
import { wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js"
import { Checkbox, CONTROLS_STYLE, NOTE_STYLE } from "./controls.tsx"
import { attachDragRecorder } from "./drag-recorder.ts"
import type { ScenarioDef } from "./types.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "drag-release"

const ROOT_STYLE: JSX.CSSProperties = { display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "8px" }
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "340px", "--stage-h": "260px" }

/** P: a `layout` parent, left 16px or 76px. Not the offsetParent of D (see ITEM_STYLE). */
const parentStyle = (right: boolean): JSX.CSSProperties => ({
  "margin-top": "16px",
  "margin-left": right ? "76px" : "16px",
  width: "240px",
  "padding-top": "20px",
  "padding-left": "20px",
})

/** D: 140 wide, 80 or 120 tall. */
const itemStyle = (tall: boolean): JSX.CSSProperties => ({
  position: "relative",
  width: "140px",
  height: tall ? "120px" : "80px",
  cursor: "grab",
  "touch-action": "none",
  "user-select": "none",
})

/** F, the free box (#139): 64px square, in the stage's bottom-left corner. */
const FREE_STYLE: JSX.CSSProperties = {
  position: "absolute",
  left: "16px",
  bottom: "16px",
  width: "64px",
  height: "64px",
  cursor: "grab",
  "touch-action": "none",
  "user-select": "none",
  "font-size": "11px",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
}

/** How long F's release may take to settle, in ms: its Fling glides on for up to about 6 s (#140: 0.75 s · ln of its glide). */
const FREE_SETTLE_MS = 7000

/** F's constraints with the bounds box (#140): on its x and y, so within the stage, on the grid's lines. */
const FREE_BOUNDS = { x: { min: 0, max: 200 }, y: { min: -150, max: 0 } } as const

/** F's `dragConstraints`, as Motion's box (#273): {@link FREE_BOUNDS}'s ranges. */
const FREE_BOX = { left: FREE_BOUNDS.x.min, right: FREE_BOUNDS.x.max, top: FREE_BOUNDS.y.min, bottom: FREE_BOUNDS.y.max } as const

/** Motion's default `dragElastic`, which F keeps (#140): what the card expects past an edge. */
const DEFAULT_ELASTIC = 0.35

/** The grid box's grid, in px (#140): F's release rests on multiples of it, on x and y. */
const GRID_PX = 50

/** Rest a release on the grid: Motion's `modifyTarget` (#140). */
const toGrid = (ideal: number): number => Math.round(ideal / GRID_PX) * GRID_PX

/** The bounds box's edges, drawn: the area F covers within its constraints (it rests at left 16, top 180). */
const BOUNDS_STYLE: JSX.CSSProperties = {
  position: "absolute",
  left: `${16 + FREE_BOUNDS.x.min}px`,
  top: `${180 + FREE_BOUNDS.y.min}px`,
  width: `${FREE_BOUNDS.x.max - FREE_BOUNDS.x.min + 64}px`,
  height: `${FREE_BOUNDS.y.max - FREE_BOUNDS.y.min + 64}px`,
  "box-sizing": "border-box",
  border: "1px dashed var(--lab-muted)",
  "pointer-events": "none",
}

/** The grid box's grid, drawn: a dot wherever F's top-left corner can rest (x 16, y 180, then every 50 px). */
const GRID_STYLE: JSX.CSSProperties = {
  position: "absolute",
  inset: "0",
  "background-image": "radial-gradient(circle, var(--lab-muted) 1.5px, transparent 2px)",
  "background-size": `${GRID_PX}px ${GRID_PX}px`,
  "background-position": "41px 5px",
  "pointer-events": "none",
}

/** How long after Z or P at rest D's own layout animation may still be running, in ms (the default transition, Motion's tween, lands at 450, #171). */
const FLIGHT_MS = 1000

/** The twin's shared `layoutId` (the twin box). */
const TWIN_ID = "lab-s13-twin"

/** The twin: D's size, parked in the stage's bottom-right corner. */
const TWIN_STYLE: JSX.CSSProperties = {
  position: "absolute",
  right: "8px",
  bottom: "8px",
  width: "140px",
  height: "80px",
  background: "var(--lab-box-alt)",
  "pointer-events": "none",
}

const C1_STYLE: JSX.CSSProperties = {
  position: "absolute",
  left: "10px",
  top: "10px",
  width: "28px",
  height: "28px",
  background: "var(--lab-box-alt)",
  "pointer-events": "none",
}

const View: ScenarioDef["View"] = (props) => {
  const [tall, setTall] = createSignal(false)
  const [right, setRight] = createSignal(false)
  const [loseNext, setLoseNext] = createSignal(false)
  const [momentum, setMomentum] = createSignal(true)
  const [twin, setTwin] = createSignal(false)
  // F's constraints and grid (#140), read at its mount, so each remounts it.
  const [bounded, setBounded] = createSignal(false)
  const [grid, setGrid] = createSignal(false)
  // Put the free box back: remounts F where it started (a flick can carry it out of the stage).
  const [freeKey, setFreeKey] = createSignal(0)
  let stage: HTMLDivElement | undefined
  let item: HTMLElement | undefined
  let free: HTMLElement | undefined
  let c1: HTMLElement | undefined
  // The item a press is on, picked before the recorder's own pointerdown: the boxes remount D,
  // so the recorder listens on the stage and reads the item at each press.
  let pressed: HTMLElement | undefined
  let dragging = false
  // From the release until the recorder ends the run: D is flying back to its slot.
  let flying = false
  // When Z or P last changed D's layout at rest, starting a layout animation of its own (#30).
  let restChangeAt = Number.NEGATIVE_INFINITY
  let noteLayoutChange = (): void => {}
  let pressing = (): boolean => false

  const onKey = (e: KeyboardEvent): void => {
    if (pressing() && (e.key === "l" || e.key === "L")) setLoseNext((v) => !v)
    const z = e.key === "z" || e.key === "Z"
    const p = e.key === "p" || e.key === "P"
    if (!z && !p) return
    noteLayoutChange()
    if (!dragging && !flying) restChangeAt = performance.now()
    if (z) setTall((t) => !t)
    else setRight((r) => !r)
  }

  onMount(() => {
    const pick = (e: PointerEvent): void => {
      // A second pointer during a press is ignored, as the recorder ignores it.
      if (pressing()) return
      const target = e.target as Node | null
      // A press off both items records nothing (the recorder finds no item).
      pressed =
        target === null
          ? undefined
          : item !== undefined && item.contains(target)
            ? item
            : free !== undefined && free.contains(target)
              ? free
              : undefined
    }
    stage?.addEventListener("pointerdown", pick, { capture: true, passive: true })
    const recorder = attachDragRecorder({
      stage: () => stage,
      item: () => pressed,
      pressArea: () => stage,
      children: () => (pressed === free ? {} : { c1 }),
      // F's runs are a free item's (#139): a Fling with momentum, none without.
      mode: () => (pressed === free ? (momentum() ? "fling" : "fling-off") : "release"),
      settleMs: () => (pressed === free ? FREE_SETTLE_MS : undefined),
      // F's constraints and grid (#140), for its `under pointer`, `stays in bounds` and `rests` lines.
      bounds: () => (pressed === free && bounded() ? { ...FREE_BOUNDS, elastic: DEFAULT_ELASTIC } : undefined),
      grid: () => (pressed === free && grid() ? GRID_PX : undefined),
      onPhase: (phase) => {
        // Only D's own gesture and release change how Z and P act.
        if (pressed === free && phase !== "end") return
        dragging = phase === "start"
        flying = phase === "release"
      },
      // D's own layout animation may still run: a Z or P at rest less than FLIGHT_MS ago. One that has
      // landed by the press reads as an ordinary drag (a 0 px slide, judged from the first frame).
      flyingAtPress: () => pressed !== free && performance.now() - restChangeAt < FLIGHT_MS,
      record: (input) => props.ctx.recordDragRun(input),
      loseNextRelease: { armed: loseNext, disarm: () => setLoseNext(false) },
    })
    noteLayoutChange = recorder.noteLayoutChange
    pressing = recorder.pressing
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      stage?.removeEventListener("pointerdown", pick, { capture: true })
      recorder.detach()
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <div data-scenario={ID} style={ROOT_STYLE}>
      <div class="stage" ref={stage} style={STAGE_STYLE}>
        {/* Drag config is read at mount: the boxes remount D (the twin first, so D is the Lead). */}
        <Show when={`${momentum()}:${twin()}`} keyed>
          {(_mount) => (
            <>
              <Show when={twin()}>
                <wardic.div layoutId={TWIN_ID} style={TWIN_STYLE} />
              </Show>
              <wardic.div layout layoutDependency={right()} style={parentStyle(right())}>
                <wardic.div
                  class="box"
                  layout
                  {...(twin() ? { layoutId: TWIN_ID } : {})}
                  drag
                  dragMomentum={momentum()}
                  layoutDependency={tall()}
                  data-action="drag"
                  // eslint-disable-next-line solid/reactivity
                  ref={(el: HTMLElement) => (item = el)}
                  style={itemStyle(tall())}
                >
                  {/* eslint-disable-next-line solid/reactivity */}
                  <wardic.div layout ref={(el: HTMLElement) => (c1 = el)} style={C1_STYLE} />
                </wardic.div>
              </wardic.div>
            </>
          )}
        </Show>
        <Show when={grid()}>
          <div style={GRID_STYLE} />
        </Show>
        <Show when={bounded()}>
          <div data-bounds style={BOUNDS_STYLE} />
        </Show>
        {/* F, the free box (#139): its momentum, constraints and grid are read at mount, so the boxes remount it too. */}
        <Show when={`${momentum()}:${freeKey()}:${bounded()}:${grid()}`} keyed>
          {(_mount) => (
            <wardic.div
              class="box"
              drag
              dragMomentum={momentum()}
              {...(bounded() ? { dragConstraints: FREE_BOX } : {})}
              {...(grid() ? { dragTransition: { modifyTarget: toGrid } } : {})}
              data-action="fling"
              // eslint-disable-next-line solid/reactivity
              ref={(el: HTMLElement) => (free = el)}
              style={FREE_STYLE}
            >
              free
            </wardic.div>
          )}
        </Show>
      </div>
      <div style={CONTROLS_STYLE}>
        <Checkbox label="momentum (dragMomentum)" name="momentum" checked={momentum()} onChange={setMomentum} />
        <Checkbox label="twin (a layoutId Follower)" name="twin" checked={twin()} onChange={setTwin} />
        <Checkbox label="lose the next release (L while held)" name="lose-next-release" checked={loseNext()} onChange={setLoseNext} />
        <Checkbox label="bounds (free box's dragConstraints)" name="bounds" checked={bounded()} onChange={setBounded} />
        <Checkbox label="grid (free box's modifyTarget, 50 px)" name="grid" checked={grid()} onChange={setGrid} />
        <button type="button" class="btn secondary small" data-action="free-back" onClick={() => setFreeKey((k) => k + 1)}>
          Put the free box back
        </button>
      </div>
      <p style={NOTE_STYLE}>
        Grab the blue item near its centre. Z resizes its slot and P moves its parent, while you hold it, while it
        flies back, or at rest (then grab it while it animates: it slides on under the pointer, no jump). L (held)
        loses its release. Release still, release while moving (a flick carries it on, with momentum), and release
        back where you grabbed while moving. Throw the free box: let go while moving and it carries on; let go still,
        or after a pause, and it stays. With bounds, drag it past the dashed edge (it lags the pointer there) and throw
        it at one: it springs back and rests on it. With the grid, it rests on a dot.
      </p>
    </div>
  )
}

/**
 * Scenario 13, release and pointer lag: the release moves on its first painted frame
 * and ends on the slot; the item paints each move in the frame it's delivered in (with a
 * browser's own scheduler too since #32) and stays under the pointer when its slot resizes
 * (Z) or its parent FLIPs (P). A slot move while it flies back keeps the flight's speed,
 * a flick carries into the release, and a Lead keeps its opacity. Expected to be safe.
 */
export const s13: ScenarioDef = {
  id: ID,
  index: 13,
  title: "Release and pointer lag",
  kind: "drag",
  mechanism:
    "Grab the blue item, move it, let go: still, while moving, or back where you grabbed while moving. Z resizes the item's own slot and P FLIPs its parent 60px right, held, flying back or at rest (then grab it mid-animation). The boxes turn off momentum, and give the item a layoutId twin. Throw the free box (bottom left): let go while moving, still, or after a pause; with bounds, past an edge; with the grid, anywhere.",
  prediction: "safe",
  rationale:
    "Since #26 a pointer move re-derives the dragged item, so it paints in the frame the move reaches it (with a " +
    "browser's own scheduler too since #32); a resized slot is painted at its new size about the same centre; a " +
    "FLIPing parent is re-derived with the item, which stays under the pointer; and the release is a FLIP to the " +
    "slot whose first step is the next frame's tick, painted in that frame (0 held from a pointerup; ADR-0033), " +
    "which always writes the resting projection when it " +
    "lands on the slot. Since the velocity family's fix (ADR-0016) the release is an offset springing to zero on " +
    "top of the item's layout, from the pointer's velocity: a slot move under it (Z, P) keeps its speed, and a " +
    "twin's Lead keeps its opacity, since only a shared-element handover crossfades. A grab during the item's own " +
    "layout animation (Z or P at rest) leaves it running under the pointer, so the item slides the rest of the way " +
    "there with no jump; the card judges the drag from where it lands. The free box's release is a Fling from the " +
    "pointer's velocity over its last 100 ms, the release point counted (#139): a flick carries on, a pause before " +
    "letting go doesn't. Since #140 every release runs on the drag transition, Motion's inertia: a Fling glides on " +
    "for seconds, and with constraints springs back to an edge it would cross and rests on it, on the 200 / 40 bounce; " +
    "a grid's modifyTarget rests it on the grid.",
  dragExpect: {
    underPointerMaxPx: 1,
    framesBehindMax: 0,
    childGlueMaxPx: 1,
    maxSeededPerPass: 1,
    releaseHeldMax: 0,
    endsOnSlotMaxPx: 0.5,
    // #31: no gesture moves the item once it should have ended (ADR-0019).
    gestureEndsMaxPx: 1,
  },
  // #139: the free box carries on when let go while moving, and stays when let go still.
  // #140: with the bounds box it rests within them; with the grid box, on it.
  flingExpect: { movingSpeed: 100, stillSpeed: 1, carriesMinPx: 2, staysMaxPx: 0.5, outsideMaxPx: 0.5 },
  View,
}
