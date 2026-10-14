/**
 * Scenario 16: a `layoutId` crossfade (#5, ADR-0010 *Amendment (#5)*), four cells, each a pair of
 * twins its button hands over between. Every handover is one board run of kind `crossfade`: the
 * recorder reads the Lead's and the Follower's computed opacity just after every painted frame,
 * until both stood still, and the card judges it (`crossfadeChecksOf` in `lab/crossfade-board.ts`).
 *
 * - **overlap**: twin A at the cell's left, painted above; Toggle overlap mounts twin B at its
 *   right, which leads from A's box while A follows it, fading. Motion's curves: B in by the
 *   handover's middle, A held until then, so the overlap is never see-through. Also watched: the
 *   point at B's centre never hits A, which paints above it (#165). Toggle scale holds A at its
 *   own `scale: 1.4` and has B mount at 0.8 (#8): each handover starts where its twin is drawn,
 *   own scale and all, and the Follower is drawn on its Lead. Toggle shape mounts the pair afresh
 *   with A rounded (14px), tilted (12°) and at 0.6 opacity, and B square (#166): each handover
 *   blends the twin's look into the Lead's own, the Follower drawn with it, and the toggle back,
 *   with nothing left on screen, blends opacity too.
 * - **in place**: ▶ and ⏸ at one box; Toggle in place mounts ⏸ on ▶. Nothing moves, and they
 *   still crossfade (Motion's: any handover animates). Before #5 the swap was instant. Toggle
 *   entrance has ⏸ mount inside a container scaling in from 0.8 about the cell's corner (#137): the
 *   twins' conversions follow that scale each frame, so ⏸ flies from ▶ into it with ▶ drawn on it,
 *   and the toggle back starts from where ⏸ is drawn.
 * - **nested**: a card holding an avatar, and a modal holding its twin avatar, under
 *   `<AnimatePresence>`; Toggle nested opens and closes the modal. The card and modal crossfade;
 *   the avatars only move, with no fade of their own (Motion's `path.some(hasOpacityCrossfade)`),
 *   so the containers' fade decides which shows. Two runs a toggle: `nested: card` and `nested: avatar`.
 *   Each container also holds a plain `layout` badge, which keeps its own shape on every frame,
 *   the Follower's included (#169: a Follower's layout nodes stay corrected for its lock), judged
 *   on the `nested: card` runs' aspect line. The cell's stage is grey, so a bar outside its
 *   container shows: Motion leaves a Follower's bar where it sits on the page, Wardic's rides it.
 * - **exit**: a thumbnail, and a modal above it under `<AnimatePresence>`; Toggle exit opens it,
 *   then closes it back onto the thumbnail, a leaving Follower that fades out over it. Also
 *   watched: the point at the thumbnail's centre never hits the leaving modal (#165).
 *
 * Closing the overlap and in place cells unmounts the Lead with no presence: its twin is promoted
 * and shows at once (Motion's: nothing left to crossfade with), a `back` run judged on where it
 * starts and ends.
 *
 * Every run is also judged on where it starts (#170): the recorder reads where the outgoing twin is
 * painted just before the toggle, and the Lead's first painted frames, so toggling mid-flight
 * shows a handover that starts from where its twin would have rested.
 *
 * @module
 */
import { AnimatePresence, wardic } from "@wardic/solid"
import { createSignal, type JSX, onCleanup, Show } from "solid-js"
import type { ScenarioContext, ScenarioDef } from "./types.ts"
import { CROSSFADE_CHECK_NAMES } from "../lab/crossfade-board.ts"

/** The scenario id, also the View root's `data-scenario` value. */
const ID = "crossfade"

const GRID: JSX.CSSProperties = {
  display: "grid",
  "grid-template-columns": "repeat(2, 1fr)",
  "grid-template-rows": "repeat(2, 1fr)",
  width: "100%",
  height: "100%",
}
const CELL: JSX.CSSProperties = { position: "relative" }
/**
 * The nested cell's grey stage (#169): a white `layout` bar outside its container shows against it,
 * where a white stage hides it. A Lead's bar near its bottom edge sits below it while it's small.
 */
const GREY_CELL: JSX.CSSProperties = { position: "relative", background: "#8a8f99", "border-radius": "6px", color: "white" }
const LABEL: JSX.CSSProperties = { position: "absolute", left: "0", right: "0", bottom: "4px", "text-align": "center", "font-size": "10px", opacity: 0.8 }
const BUTTONS: JSX.CSSProperties = { display: "flex", "flex-wrap": "wrap", gap: "6px", "margin-top": "6px" }
/** The in-place cell's entrance (#137): the whole cell, scaling about its top-left corner, so ⏸ moves as it grows. */
const ENTRANCE: JSX.CSSProperties = { position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%", "transform-origin": "0px 0px" }
/** Two rows of two cells, each wide enough for its twins apart. */
const STAGE_STYLE: JSX.CSSProperties = { "--stage-w": "420px", "--stage-h": "320px" }

const ACCENT = "var(--lab-accent, rgb(0, 102, 204))"
const ALT = "rgb(204, 85, 0)"
/** An absolutely placed box in its cell. */
const box = (left: number, top: number, width: number, height: number, background: string, zIndex: number): JSX.CSSProperties => ({
  position: "absolute",
  left: `${left}px`,
  top: `${top}px`,
  width: `${width}px`,
  height: `${height}px`,
  background,
  "border-radius": "6px",
  "z-index": zIndex,
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  color: "white",
  "font-size": "16px",
})
/** A plain `layout` badge in its container (#169): a bar whose shape a stretch would show. */
const badge = (left: number, top: number, width: number, height: number): JSX.CSSProperties => ({
  position: "absolute",
  left: `${left}px`,
  top: `${top}px`,
  width: `${width}px`,
  height: `${height}px`,
  background: "rgba(255, 255, 255, 0.85)",
  "border-radius": "2px",
})
/** The card's badge and the modal's: their own width-to-height ratios. */
const CARD_BADGE = { left: 6, top: 38, width: 32, height: 8 } as const
const MODAL_BADGE = { left: 10, top: 92, width: 48, height: 10 } as const

/** An avatar in its container, at `(left, top)`. */
const avatar = (left: number, top: number, size: number): JSX.CSSProperties => ({
  position: "absolute",
  left: `${left}px`,
  top: `${top}px`,
  width: `${size}px`,
  height: `${size}px`,
  background: "white",
  "border-radius": "50%",
})

/** How many still frames end a run, and how long one may take. */
const STILL_FRAMES = 6
const SETTLE_MS = 4000

/** An element's computed opacity, or `null` once it's gone. */
const opacityOf = (el: Element | undefined): number | null =>
  el === undefined || !el.isConnected ? null : Number(getComputedStyle(el).opacity)

/** Whether the point at `lead`'s centre hits `follower` (#165). */
const hits = (lead: Element, follower: Element): boolean => {
  const r = lead.getBoundingClientRect()
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return at !== null && follower.isConnected && follower.contains(at)
}

/** What one run reads, and what else it watches. */
interface Watch {
  readonly cell: string
  readonly lead: () => Element | undefined
  readonly follower: () => Element | undefined
  readonly hits?: boolean
  readonly onlyMoves?: boolean
  /** Where the outgoing twin was painted just before the toggle (#170). */
  readonly startsFrom?: Drawn
  /** A toggle back with no twin left to fade (#170). */
  readonly back?: boolean
  /** The pair of twins it hands over between, which a later run on the pair supersedes; its cell by default. */
  readonly pair?: string
  /** The `layout` badges in the Lead's and the Follower's containers, and their own ratios (#169). */
  readonly badges?: {
    readonly lead: () => Element | undefined
    readonly follower: () => Element | undefined
    readonly own: { readonly lead: number; readonly follower: number }
  }
  /** The outgoing twin's look as drawn at the toggle (#166), when the run watches the blend. */
  readonly lookFrom?: Look
  /** Each twin's own opacity, when one is translucent on purpose (#166's shaped A). */
  readonly ownOpacity?: { readonly lead: number; readonly follower: number }
}

/** How an element is drawn (#166): its top-left radius in px as painted, its rotation in degrees, its opacity. */
type Look = { readonly radius: number; readonly rotate: number; readonly opacity: number }

/** `el`'s look as drawn, or `null` when it isn't on the page. */
const lookOf = (el: Element | undefined): Look | null => {
  if (el === undefined || !el.isConnected) return null
  const cs = getComputedStyle(el)
  const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform)
  return {
    radius: Number.parseFloat(cs.borderTopLeftRadius) * Math.hypot(m.a, m.b),
    rotate: (Math.atan2(m.b, m.a) * 180) / Math.PI,
    opacity: Number(cs.opacity),
  }
}

/** An element's painted width-to-height ratio, or `null` when it isn't on the page. */
const aspectOf = (el: Element | undefined): number | null => {
  if (el === undefined || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  return r.width / r.height
}

/** Where an element is painted: its top-left, or `undefined` when it isn't on the page. */
/** Where an element is drawn: its top-left and size (#8: an own scale changes both). */
type Drawn = { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** The furthest edge between where two elements are drawn (#8). */
const apartOf = (a: Element, b: Element): number => {
  const p = a.getBoundingClientRect()
  const q = b.getBoundingClientRect()
  return Math.max(Math.abs(p.left - q.left), Math.abs(p.top - q.top), Math.abs(p.right - q.right), Math.abs(p.bottom - q.bottom))
}

const paintedAt = (el: Element | undefined): Drawn | undefined => {
  if (el === undefined || !el.isConnected) return undefined
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/**
 * Sample each watched run just after every painted frame (a `MessageChannel` message posted from
 * each rAF runs after that frame's rendering, as scenario 15's recorder reads) until both twins'
 * opacity and the Lead's painted position stood still, then record it. A handover that only moves
 * keeps its opacity throughout, so its position is what says it's over. A new run on a cell
 * records the one still sampling there as superseded, cut at the new one's start: the twins have
 * swapped roles since. Closed unrecorded when the View goes.
 */
const makeRecorder = (ctx: ScenarioContext) => {
  const sampling = new Set<MessageChannel>()
  // Each pair of twins' run still sampling: a new run on the pair (either way) supersedes it.
  const current = new Map<string, () => void>()
  const start = (watch: Watch): void => {
    const pair = watch.pair ?? watch.cell
    current.get(pair)?.()
    const startedAt = performance.now()
    const leads: Array<number> = []
    const followers: Array<number | null> = []
    const hit: Array<boolean> = []
    // The Lead's painted top-left, each frame: a handover that only moves is still only once it stops.
    const where: Array<number> = []
    const path: Array<Drawn> = []
    // While the Follower shows, how far it's drawn from its Lead, each frame (#8).
    const follows: Array<number> = []
    const aspects: Array<{ readonly lead: number | null; readonly follower: number | null }> = []
    // Each frame, the Lead's look and the Follower's (#166).
    const looks: Array<{ readonly lead: Look; readonly follower: Look | null }> = []
    const channel = new MessageChannel()
    sampling.add(channel)
    const finish = (superseded = false): void => {
      channel.port1.close()
      sampling.delete(channel)
      if (current.get(pair) === supersede) current.delete(pair)
      ctx.recordBoardRun({
        cell: watch.cell,
        kind: "crossfade",
        base: 0,
        target: 1,
        before: Number.NaN,
        during: leads,
        after: [],
        startedAt,
        endedAt: performance.now(),
        crossfade: {
          follower: followers,
          ...(watch.hits === true ? { hitsFollower: hit } : {}),
          ...(watch.onlyMoves === true ? { onlyMoves: true } : {}),
          ...(watch.startsFrom === undefined ? {} : { startsFrom: watch.startsFrom, leadPath: path }),
          ...(watch.back === true ? {} : { follows }),
          ...(watch.back === true ? { back: true } : {}),
          ...(watch.badges === undefined ? {} : { aspects, ownAspects: watch.badges.own }),
          ...(watch.lookFrom === undefined ? {} : { lookFrom: watch.lookFrom, looks }),
          ...(watch.ownOpacity === undefined ? {} : { ownOpacity: watch.ownOpacity }),
        },
        ...(superseded ? { superseded: true } : {}),
      })
    }
    const supersede = (): void => finish(true)
    current.set(pair, supersede)
    channel.port1.onmessage = () => {
      const lead = watch.lead()
      const follower = watch.follower()
      const l = opacityOf(lead)
      if (l === null) {
        finish()
        return
      }
      const f = opacityOf(follower)
      leads.push(l)
      followers.push(f)
      const r = lead!.getBoundingClientRect()
      where.push(r.left * 10_000 + r.top)
      if (path.length < 2) path.push({ x: r.left, y: r.top, w: r.width, h: r.height })
      if (follower !== undefined && f !== null && f > 0.01) follows.push(apartOf(lead!, follower))
      if (watch.badges !== undefined) aspects.push({ lead: aspectOf(watch.badges.lead()), follower: aspectOf(watch.badges.follower()) })
      if (watch.lookFrom !== undefined) looks.push({ lead: lookOf(lead)!, follower: lookOf(follower) })
      if (watch.hits === true && lead !== undefined && follower !== undefined) hit.push(hits(lead, follower))
      const tail = (xs: ReadonlyArray<number | null>) => xs.slice(-STILL_FRAMES)
      const still = (xs: ReadonlyArray<number | null>) =>
        tail(xs).length === STILL_FRAMES && tail(xs).every((v) => v === tail(xs)[0] || (v !== null && tail(xs)[0] !== null && Math.abs(v - tail(xs)[0]!) < 0.0005))
      // A Lead translucent on purpose (#166's shaped A) comes in to its own opacity, not 1.
      const ownLead = watch.ownOpacity?.lead ?? 1
      if ((still(leads) && still(followers) && still(where) && l / ownLead >= 0.99) || performance.now() - startedAt > SETTLE_MS) {
        finish()
        return
      }
      requestAnimationFrame(() => channel.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => channel.port2.postMessage(undefined))
  }
  const dispose = (): void => {
    for (const channel of sampling) channel.port1.close()
    sampling.clear()
  }
  return { start, dispose }
}

/** The scenario View. */
const View: ScenarioDef["View"] = (props) => {
  const recorder = makeRecorder(props.ctx)
  onCleanup(recorder.dispose)

  const [overlap, setOverlap] = createSignal(false)
  // The overlap twins' own scales (#8): A held at 1.4, B mounting at 0.8.
  const [scaled, setScaled] = createSignal(false)
  // The overlap twins' looks (#166): A rounded, tilted and at 0.6 opacity, B square. A radius is read
  // at a twin's first measure, so a toggle mounts the pair afresh, under their own layoutId.
  const [shaped, setShaped] = createSignal(false)
  // The in-place cell's ⏸ mounts in a container scaling in from 0.8 (#137): the twin flies into a
  // container Wardic is scaling, which the twins' conversions follow each frame.
  const [entrance, setEntrance] = createSignal(false)
  const OverlapTwins = (p: { readonly shape: boolean }) => {
    const id = p.shape ? "lab-s16-shape" : "lab-s16-overlap"
    return (
      <>
        <wardic.div
          ref={keep("overlapA")}
          layoutId={id}
          animate={{ scale: scaled() ? 1.4 : 1, rotate: p.shape ? 12 : 0, opacity: p.shape ? 0.6 : 1 }}
          style={{ ...box(16, 40, 56, 40, ACCENT, 2), ...(p.shape ? { "border-radius": "14px" } : {}) }}
        >
          A
        </wardic.div>
        <Show when={overlap()}>
          <wardic.div
            ref={keep("overlapB")}
            layoutId={id}
            initial={{ scale: scaled() ? 0.8 : 1 }}
            animate={{ scale: scaled() ? 0.8 : 1 }}
            style={{ ...box(130, 40, 56, 40, ALT, 1), ...(p.shape ? { "border-radius": "0px" } : {}) }}
          >
            B
          </wardic.div>
        </Show>
      </>
    )
  }
  const [inPlace, setInPlace] = createSignal(false)
  const [nested, setNested] = createSignal(false)
  const [exit, setExit] = createSignal(false)
  const el: Record<string, Element | undefined> = {}
  const at = (name: string) => () => el[name]
  const keep = (name: string) => (node: Element) => {
    el[name] = node
  }

  // Each toggle reads where the outgoing twin is painted before the state changes (#170).
  const gone = () => undefined
  const toggleOverlap = (): void => {
    const opening = !overlap()
    const from = paintedAt(el[opening ? "overlapA" : "overlapB"])
    const look = lookOf(el[opening ? "overlapA" : "overlapB"]) ?? undefined
    setOverlap(opening)
    // The shaped A is at 0.6 of its own: the lines on opacity judge its crossfade factor.
    const a = shaped() ? 0.6 : 1
    const lookFrom = {
      ...(look === undefined ? {} : { lookFrom: look }),
      ...(shaped() ? { ownOpacity: opening ? { lead: 1, follower: a } : { lead: a, follower: 1 } } : {}),
    }
    if (opening) recorder.start({ cell: "overlap", pair: "overlap", lead: at("overlapB"), follower: at("overlapA"), hits: true, startsFrom: from, ...lookFrom })
    else recorder.start({ cell: "overlap: back", pair: "overlap", lead: at("overlapA"), follower: gone, startsFrom: from, back: true, ...lookFrom })
  }
  const toggleInPlace = (): void => {
    const opening = !inPlace()
    const from = paintedAt(el[opening ? "play" : "pause"])
    setInPlace(opening)
    if (opening) recorder.start({ cell: "in place", pair: "in place", lead: at("pause"), follower: at("play"), startsFrom: from })
    else recorder.start({ cell: "in place: back", pair: "in place", lead: at("play"), follower: gone, startsFrom: from, back: true })
  }
  const toggleNested = (): void => {
    const opening = !nested()
    const card = paintedAt(el[opening ? "card" : "modal"])
    const face = paintedAt(el[opening ? "cardAvatar" : "modalAvatar"])
    setNested(opening)
    if (opening) {
      recorder.start({
        cell: "nested: card",
        lead: at("modal"),
        follower: at("card"),
        startsFrom: card,
        badges: { lead: at("modalBadge"), follower: at("cardBadge"), own: { lead: MODAL_BADGE.width / MODAL_BADGE.height, follower: CARD_BADGE.width / CARD_BADGE.height } },
      })
      recorder.start({ cell: "nested: avatar", lead: at("modalAvatar"), follower: at("cardAvatar"), onlyMoves: true, startsFrom: face })
    } else {
      recorder.start({
        cell: "nested: card",
        lead: at("card"),
        follower: at("modal"),
        startsFrom: card,
        badges: { lead: at("cardBadge"), follower: at("modalBadge"), own: { lead: CARD_BADGE.width / CARD_BADGE.height, follower: MODAL_BADGE.width / MODAL_BADGE.height } },
      })
      recorder.start({ cell: "nested: avatar", lead: at("cardAvatar"), follower: at("modalAvatar"), onlyMoves: true, startsFrom: face })
    }
  }
  const toggleExit = (): void => {
    const opening = !exit()
    const from = paintedAt(el[opening ? "thumb" : "exitModal"])
    setExit(opening)
    if (opening) recorder.start({ cell: "exit: open", pair: "exit", lead: at("exitModal"), follower: at("thumb"), startsFrom: from })
    else recorder.start({ cell: "exit: close", pair: "exit", lead: at("thumb"), follower: at("exitModal"), hits: true, startsFrom: from })
  }

  return (
    <div data-scenario={ID}>
      <div class="stage" style={STAGE_STYLE}>
        <div style={GRID}>
          <div style={CELL} data-cell="overlap">
            <Show when={shaped()} fallback={<OverlapTwins shape={false} />}>
              <OverlapTwins shape={true} />
            </Show>
            <span style={LABEL}>overlap</span>
          </div>
          <div style={CELL} data-cell="in-place">
            <wardic.div ref={keep("play")} layoutId="lab-s16-in-place" style={box(76, 40, 56, 40, ACCENT, 1)}>▶</wardic.div>
            <Show when={inPlace()}>
              <Show when={entrance()} fallback={<wardic.div ref={keep("pause")} layoutId="lab-s16-in-place" style={box(76, 40, 56, 40, ALT, 1)}>⏸</wardic.div>}>
                <wardic.div data-entrance initial={{ scale: 0.8 }} animate={{ scale: 1 }} style={ENTRANCE}>
                  <wardic.div ref={keep("pause")} layoutId="lab-s16-in-place" style={box(76, 40, 56, 40, ALT, 1)}>⏸</wardic.div>
                </wardic.div>
              </Show>
            </Show>
            <span style={LABEL}>in place</span>
          </div>
          <div style={GREY_CELL} data-cell="nested">
            <wardic.div data-twin="card" ref={keep("card")} layoutId="lab-s16-card" style={box(12, 36, 72, 56, ACCENT, 1)}>
              <wardic.div data-twin="card-avatar" ref={keep("cardAvatar")} layoutId="lab-s16-avatar" style={avatar(6, 6, 20)} />
              <wardic.div data-twin="card-badge" ref={keep("cardBadge")} layout style={badge(CARD_BADGE.left, CARD_BADGE.top, CARD_BADGE.width, CARD_BADGE.height)} />
            </wardic.div>
            <AnimatePresence>
              <Show when={nested()}>
                <wardic.div data-twin="modal" ref={keep("modal")} layoutId="lab-s16-card" style={box(100, 12, 100, 112, ALT, 2)} exit={{ opacity: 0 }}>
                  <wardic.div data-twin="modal-avatar" ref={keep("modalAvatar")} layoutId="lab-s16-avatar" style={avatar(10, 10, 34)} />
                  <wardic.div data-twin="modal-badge" ref={keep("modalBadge")} layout style={badge(MODAL_BADGE.left, MODAL_BADGE.top, MODAL_BADGE.width, MODAL_BADGE.height)} />
                </wardic.div>
              </Show>
            </AnimatePresence>
            <span style={LABEL}>nested</span>
          </div>
          <div style={CELL} data-cell="exit">
            <wardic.div ref={keep("thumb")} layoutId="lab-s16-exit" style={box(16, 44, 48, 36, ACCENT, 1)} />
            <AnimatePresence>
              <Show when={exit()}>
                <wardic.div ref={keep("exitModal")} layoutId="lab-s16-exit" style={box(96, 16, 100, 96, ALT, 2)} exit={{ opacity: 0 }} />
              </Show>
            </AnimatePresence>
            <span style={LABEL}>exit</span>
          </div>
        </div>
      </div>
      <div style={BUTTONS}>
        <button type="button" class="btn secondary small" data-action="toggle-overlap" onClick={toggleOverlap}>
          Toggle overlap
        </button>
        <button type="button" class="btn secondary small" data-action="toggle-scale" onClick={() => setScaled(!scaled())}>
          Toggle scale
        </button>
        <button type="button" class="btn secondary small" data-action="toggle-shape" onClick={() => setShaped(!shaped())}>
          Toggle shape
        </button>
        <button type="button" class="btn secondary small" data-action="toggle-in-place" onClick={toggleInPlace}>
          Toggle in place
        </button>
        <button type="button" class="btn secondary small" data-action="toggle-entrance" onClick={() => setEntrance(!entrance())}>
          Toggle entrance
        </button>
        <button type="button" class="btn secondary small" data-action="toggle-nested" onClick={toggleNested}>
          Toggle nested
        </button>
        <button type="button" class="btn secondary small" data-action="toggle-exit" onClick={toggleExit}>
          Toggle exit
        </button>
      </div>
    </div>
  )
}

/**
 * Scenario 16, crossfade (#5): four pairs of `layoutId` twins, each handover judged on its two
 * twins' opacity, frame by frame, against Motion's curves.
 */
export const s16: ScenarioDef = {
  id: ID,
  index: 16,
  kind: "board",
  boardLines: CROSSFADE_CHECK_NAMES,
  title: "crossfade (layoutId twins)",
  mechanism:
    "Toggle overlap mounts a twin beside a live one, Toggle scale gives the two their own scales, and Toggle shape a rounded, tilted, translucent A and a square B; Toggle in place mounts one on the other at its box, and Toggle entrance inside a container scaling in; Toggle nested opens and closes a modal holding an avatar twin and a layout badge, under AnimatePresence; Toggle exit opens a modal and closes it back onto its thumbnail. Each handover is judged on where it starts, the Follower drawn on its Lead, the twin's look blended into the Lead's, and its twins' opacity every frame: never see-through, the Lead in before the Follower fades, a fade not a swap, and where they end; a nested avatar on having no fade of its own; each container's badge on keeping its shape; and the overlap and the closing exit on the Lead's point never hitting the Follower.",
  prediction: "safe",
  rationale:
    "Motion's crossfade (motion-dom 13.3.0, mix-values.ts): the Lead fades in over the first half of the handover " +
    "(circOut) and its Followers out over 0.5–0.95, linearly, so the overlap is never see-through. Any handover " +
    "animates, so twins at one box crossfade. A node under a crossfading ancestor moves without a fade of its own " +
    "(path.some(hasOpacityCrossfade)). A Follower takes no pointer input (#165), and its layout nodes stay corrected " +
    "for its lock and ride it (#169; Motion leaves them where they sit on the page). A handover starts where its twin " +
    "is drawn, own scale and all, and a Follower is drawn where its Lead is (#8, Motion's lead.latestValues); a Lead " +
    "with its own scale starts drawn on its twin, where Motion jumps. The twin's border radius and rotation, and in a " +
    "Switch its opacity, ease into the Lead's own (#166, Motion's mixValues). The twins' conversions follow the translate and " +
    "scale Wardic animates on their ancestors each frame (#137), where Motion starts 80px off. ADR-0010, Amendment (#5).",
  View,
}
