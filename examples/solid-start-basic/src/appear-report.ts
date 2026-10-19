// The /appear route's report (#48, ADR-0044's hand check). Client-only, plain DOM: it renders
// outside the hydrated tree, so it adds no hydration keys.
//
// 1. `startAppearRecorder()` runs in entry-client.tsx BEFORE SolidStart mounts. Every frame, for
//    each element marked `data-appear-k`, it records what the element draws (opacity, x, y,
//    rotate; an SVG element's cx, r and stroke dash, #245) and whether its CSS animation still runs. It reads after the frame's callbacks (a
//    task posted from the frame's rAF callback), so it sees what the engine drew that frame. A
//    read that runs into the next frame is skipped (#184's late post-paint reads).
// 2. `markHydration()` notes when hydration starts (`?hydrate=<ms>` delays it), and the route's
//    `wardic:appear-mounted` event when it has mounted: in dev, on a phone, loading the route's
//    code can take seconds after that.
// 3. Once every element has been taken over (and 300 ms of frames after), or 2.5 s after the route mounted (60 s from the
//    recorder's start at most), it judges each element:
//    - PLAYED: it moved while its CSS animation ran, or that animation had already run before the
//      first frame recorded (the page's script loads after first paint), or it was still in its delay when
//      the engine took it over (a stagger's later items), or, under reduced motion, it holds still
//      (`data-appear-positional`: every key it animates snaps). An element marked
//      `data-appear-expect="held"` (`appear={false}`) must not have moved before hydration instead.
//    - SMOOTH: around the Handoff, the first frame its CSS animation is gone, no move per ms is more
//      than twice the largest of the two frames' either side (per channel, give or take 0.5 px, 0.02,
//      2° a frame): a motion that starts a frame before the Handoff has a still frame just before it.
//      An `appear={false}` element has nothing to hand over from.
//    - DONE: its CSS animation is gone, and its inline `animation` with it.
//
// "Save log" posts the rows and every frame to /api/save-log (examples/solid-start-basic/logs/).

interface Drawn {
  readonly opacity: number
  readonly x: number
  readonly y: number
  readonly rotate: number
  /** An SVG element's `cx`, `r` and stroke dash (#245); 0 where it has none. */
  readonly cx: number
  readonly r: number
  readonly dash: number
  readonly css: boolean
  /** Its CSS animation is still in its delay. */
  readonly waiting: boolean
  /** How far its CSS animation has got, in ms; 0 without one. */
  readonly cssTime: number
}

interface Recorded {
  readonly at: number
  readonly hydrated: boolean
  readonly drawn: Readonly<Record<string, Drawn>>
}

export interface AppearRow {
  readonly k: string
  readonly verdict: "OK" | "FAIL"
  readonly played: boolean
  readonly smooth: boolean
  readonly done: boolean
  readonly note: string
}

const frames: Array<Recorded> = []
let hydratedAt: number | undefined
let mountedAt: number | undefined
let allHandedOffAt: number | undefined
let judged = false
let frameCount = 0

const drawnOf = (el: Element): Drawn => {
  const computed = getComputedStyle(el)
  const m = new DOMMatrix(computed.transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  const animation = el.getAnimations()[0]
  const waiting =
    animation !== undefined && Number(animation.currentTime ?? 0) < Number(animation.effect?.getTiming().delay ?? 0)
  return {
    opacity: Number(computed.opacity),
    x: m.m41,
    y: m.m42,
    rotate: (Math.atan2(m.m12, m.m11) * 180) / Math.PI,
    cx: Number.parseFloat(computed.getPropertyValue("cx")) || 0,
    r: Number.parseFloat(computed.getPropertyValue("r")) || 0,
    dash: Number.parseFloat(computed.getPropertyValue("stroke-dasharray")) || 0,
    css: animation !== undefined,
    waiting,
    cssTime: Number(animation?.currentTime ?? 0),
  }
}

/** Start recording, before SolidStart mounts. Only on /appear. */
export const startAppearRecorder = (): void => {
  if (location.pathname !== "/appear") return
  const began = performance.now()
  const count = (): void => {
    frameCount++
    requestAnimationFrame(count)
  }
  requestAnimationFrame(count)
  const frame = (now: number): void => {
    const seen = frameCount
    setTimeout(() => {
      if (frameCount !== seen) return
      const drawn: Record<string, Drawn> = {}
      for (const el of document.querySelectorAll("[data-appear-k]")) drawn[(el as HTMLElement).dataset.appearK!] = drawnOf(el)
      frames.push({ at: now, hydrated: hydratedAt !== undefined && now >= hydratedAt, drawn })
    }, 0)
    const handedOff = (): boolean => {
      const last = frames.at(-1)
      return last !== undefined && last.hydrated && Object.values(last.drawn).every((d) => !d.css)
    }
    // Every element taken over, and 300 ms of frames after the last, to judge its Handoff by.
    if (allHandedOffAt === undefined && handedOff()) allHandedOffAt = now
    const settledAfter = allHandedOffAt !== undefined && now - allHandedOffAt > 300
    const done = (mountedAt !== undefined && (now - mountedAt > 2500 || (now - mountedAt > 500 && settledAfter))) || now - began > 60000
    if (!done) requestAnimationFrame(frame)
    else if (!judged) {
      judged = true
      judge()
    }
  }
  requestAnimationFrame(frame)
  window.addEventListener("wardic:appear-mounted", () => (mountedAt = performance.now()), { once: true })
}

/** Hydration starts now. */
export const markHydration = (): void => {
  hydratedAt = performance.now()
}

const CHANNELS = [
  ["opacity", 0.02],
  ["x", 0.5],
  ["y", 0.5],
  ["rotate", 2],
  ["cx", 0.5],
  ["r", 0.5],
  ["dash", 0.02],
] as const

/** The smallest angle between two, in degrees. */
const turn = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

const judge = (): void => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  const rows: Array<AppearRow> = []
  for (const el of document.querySelectorAll<HTMLElement>("[data-appear-k]")) {
    const k = el.dataset.appearK!
    const held = el.dataset.appearExpect === "held"
    const mine = frames.filter((f) => f.drawn[k] !== undefined)
    const handoff = mine.findIndex((f) => f.hydrated && !f.drawn[k]!.css)
    // What the CSS drew: every frame before hydration for a held element, else every frame its animation ran.
    const css = mine.filter((f) => (held ? !f.hydrated : f.drawn[k]!.css))
    const first = css[0]?.drawn[k]
    const moved = css.some((f) => CHANNELS.some(([c, eps]) => Math.abs(f.drawn[k]![c] - first![c]) > eps))
    // Its CSS ran at most a frame past its delay before the engine took over: nothing to see yet.
    const waitedThrough = handoff > 0 && css.filter((f) => !f.drawn[k]!.waiting).length <= 1 && css.some((f) => f.drawn[k]!.waiting)
    // Its CSS had been running a while before the first frame recorded: it played before the page's script.
    const ranBefore = !held && (first?.cssTime ?? 0) > 100
    const stillUnderReduce = reduced && el.dataset.appearPositional !== undefined
    // Taken over within a couple of frames of the first one recorded: the CSS had no time to move it.
    const atOnce = handoff >= 0 && handoff <= 2
    const played = held ? !moved : moved || ranBefore || waitedThrough || atOnce || (stillUnderReduce && !moved)
    const step = (i: number, c: (typeof CHANNELS)[number][0]): number => {
      const a = mine[i]?.drawn[k]
      const b = mine[i - 1]?.drawn[k]
      if (a === undefined || b === undefined) return 0
      return c === "rotate" ? turn(a[c], b[c]) : Math.abs(a[c] - b[c])
    }
    // Per ms, so a long frame (a busy phone, a read skipped as late) isn't a step: a frame's move
    // over the time since the frame before it.
    const rate = (i: number, c: (typeof CHANNELS)[number][0]): number => {
      const gap = (mine[i]?.at ?? 0) - (mine[i - 1]?.at ?? 0)
      return gap > 0 ? step(i, c) / gap : 0
    }
    // An appear={false} element has no CSS to hand over from: its mount is its start.
    const smooth =
      held ||
      handoff <= 0 ||
      CHANNELS.every(
        ([c, eps]) =>
          rate(handoff, c) <= 2 * Math.max(rate(handoff - 2, c), rate(handoff - 1, c), rate(handoff + 1, c), rate(handoff + 2, c)) + eps / 16.7,
      )
    const done = !el.getAnimations().length && el.style.getPropertyValue("animation") === ""
    const notes = [
      played ? "" : held ? "moved before hydration" : "its CSS didn't move it",
      waitedThrough ? "its CSS was in its delay until the Handoff" : "",
      ranBefore && !moved ? `its CSS had run ${(first!.cssTime | 0)} ms before the page's script did` : "",
      atOnce && !moved ? "taken over at once" : "",
      smooth ? "" : `stepped at the Handoff (${CHANNELS.map(([c]) => `${c} ${step(handoff, c).toFixed(2)}`).join(", ")})`,
      done ? "" : "its CSS animation is still there",
      handoff < 0 ? "never handed off" : `handed off ${((mine[handoff]!.at - hydratedAt!) | 0)} ms after hydration started`,
    ].filter(Boolean)
    rows.push({ k, verdict: played && smooth && done ? "OK" : "FAIL", played, smooth, done, note: notes.join("; ") })
  }
  renderPanel(rows)
  ;(window as unknown as { __appearReport: unknown }).__appearReport = { rows, frames, hydratedAt, mountedAt }
}

const renderPanel = (rows: ReadonlyArray<AppearRow>): void => {
  const panel = document.createElement("aside")
  panel.setAttribute("data-appear-report", "")
  panel.style.cssText = "font: 13px/1.4 system-ui, sans-serif; margin: 1rem; padding: .75rem; border: 2px solid #333; border-radius: 8px; max-width: 40rem"
  const head = document.createElement("h2")
  head.textContent = `Appear report: ${rows.filter((r) => r.verdict === "OK").length}/${rows.length} OK; script at ${(frames[0]?.at ?? 0) | 0} ms, hydration from ${(hydratedAt ?? 0) | 0} ms, mounted at ${mountedAt === undefined ? "never" : mountedAt | 0} ms`
  head.style.margin = "0 0 .5rem"
  panel.append(head)
  for (const row of rows) {
    const line = document.createElement("div")
    line.textContent = `${row.k}: ${row.verdict}${row.note === "" ? "" : ` (${row.note})`}`
    line.style.color = row.verdict === "OK" ? "#070" : "#b00"
    panel.append(line)
  }
  const save = document.createElement("button")
  save.type = "button"
  save.textContent = "Save log to repo"
  const status = document.createElement("span")
  status.style.marginLeft = ".5rem"
  save.onclick = async () => {
    status.textContent = "saving…"
    try {
      const response = await fetch("/api/save-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          route: "appear",
          url: location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          hydratedAt,
          mountedAt,
          rows,
          frames,
        }),
      })
      const body = (await response.json()) as { path?: string; error?: string }
      status.textContent = response.ok ? `saved: ${body.path}` : `failed: ${body.error}`
    } catch (error) {
      status.textContent = `failed: ${String(error)}`
    }
  }
  const actions = document.createElement("p")
  actions.append(save, status)
  panel.append(actions)
  document.body.append(panel)
}
