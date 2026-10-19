// The /appear route's report (#48, ADR-0044's hand check). Client-only, plain DOM: it renders
// outside the hydrated tree, so it adds no hydration keys.
//
// 1. `startAppearRecorder()` runs in entry-client.tsx BEFORE SolidStart mounts. Every frame, for
//    each element marked `data-appear-k`, it records what the element draws (opacity, x, y,
//    rotate) and whether its CSS animation still runs. It reads after the frame's callbacks (a
//    task posted from the frame's rAF callback), so it sees what the engine drew that frame. A
//    read that runs into the next frame is skipped (#184's late post-paint reads).
// 2. `markHydration()` notes when hydration starts (`?hydrate=<ms>` delays it).
// 3. Two seconds after hydration it judges each element:
//    - PLAYED: it moved while its CSS animation ran, or that animation was still in its delay when
//      the engine took it over (a stagger's later items), or, under reduced motion, it holds still
//      (`data-appear-positional`: every key it animates snaps). An element marked
//      `data-appear-expect="held"` (`appear={false}`) must not have moved before hydration instead.
//    - SMOOTH: around the Handoff, the first frame its CSS animation is gone, no step is more than
//      twice the larger of its neighbours' (per channel, give or take 0.5 px, 0.02, 2°).
//    - DONE: its CSS animation is gone, and its inline `animation` with it.
//
// "Save log" posts the rows and every frame to /api/save-log (examples/solid-start-basic/logs/).

interface Drawn {
  readonly opacity: number
  readonly x: number
  readonly y: number
  readonly rotate: number
  readonly css: boolean
  /** Its CSS animation is still in its delay. */
  readonly waiting: boolean
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
let frameCount = 0

const drawnOf = (el: Element): Drawn => {
  const computed = getComputedStyle(el)
  const m = new DOMMatrix(computed.transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
  const animation = el.getAnimations()[0]
  const waiting =
    animation !== undefined && Number(animation.currentTime ?? 0) < Number(animation.effect?.getTiming().delay ?? 0)
  return { opacity: Number(computed.opacity), x: m.m41, y: m.m42, rotate: (Math.atan2(m.m12, m.m11) * 180) / Math.PI, css: animation !== undefined, waiting }
}

/** Start recording, before SolidStart mounts. Only on /appear. */
export const startAppearRecorder = (): void => {
  if (location.pathname !== "/appear") return
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
    if (hydratedAt === undefined || now - hydratedAt < 2000) requestAnimationFrame(frame)
    else judge()
  }
  requestAnimationFrame(frame)
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
    const stillUnderReduce = reduced && el.dataset.appearPositional !== undefined
    const played = held ? !moved : moved || waitedThrough || (stillUnderReduce && !moved)
    const step = (i: number, c: (typeof CHANNELS)[number][0]): number => {
      const a = mine[i]?.drawn[k]
      const b = mine[i - 1]?.drawn[k]
      if (a === undefined || b === undefined) return 0
      return c === "rotate" ? turn(a[c], b[c]) : Math.abs(a[c] - b[c])
    }
    const smooth =
      handoff <= 0 ||
      CHANNELS.every(([c, eps]) => step(handoff, c) <= 2 * Math.max(step(handoff - 1, c), step(handoff + 1, c)) + eps)
    const done = !el.getAnimations().length && el.style.getPropertyValue("animation") === ""
    const notes = [
      played ? "" : held ? "moved before hydration" : "its CSS didn't move it",
      waitedThrough ? "its CSS was in its delay until the Handoff" : "",
      smooth ? "" : `stepped at the Handoff (${CHANNELS.map(([c]) => `${c} ${step(handoff, c).toFixed(2)}`).join(", ")})`,
      done ? "" : "its CSS animation is still there",
      handoff < 0 ? "never handed off" : `handed off ${((mine[handoff]!.at - hydratedAt!) | 0)} ms after hydration started`,
    ].filter(Boolean)
    rows.push({ k, verdict: played && smooth && done ? "OK" : "FAIL", played, smooth, done, note: notes.join("; ") })
  }
  renderPanel(rows)
  ;(window as unknown as { __appearReport: unknown }).__appearReport = { rows, frames }
}

const renderPanel = (rows: ReadonlyArray<AppearRow>): void => {
  const panel = document.createElement("aside")
  panel.setAttribute("data-appear-report", "")
  panel.style.cssText = "font: 13px/1.4 system-ui, sans-serif; margin: 1rem; padding: .75rem; border: 2px solid #333; border-radius: 8px; max-width: 40rem"
  const head = document.createElement("h2")
  head.textContent = `Appear report: ${rows.filter((r) => r.verdict === "OK").length}/${rows.length} OK, hydrated ${(hydratedAt ?? 0) | 0} ms in`
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
