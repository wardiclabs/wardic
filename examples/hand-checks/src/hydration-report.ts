// The /ssr route's hydration report (ADR-0021's hand check, #41), shared by the start examples
// (Solid 1's and Solid 2's, #209). Client-only, plain DOM: it renders outside the hydrated tree, so
// it adds no hydration keys.
//
// 1. `snapshotServerMarkup()` runs in the example's client entry BEFORE the app hydrates: for every
//    element marked `data-ssr-k`, it keeps the node, its attributes and what the server's
//    paint shows (the visible opacity, the left edge on the page, an SVG cx).
// 2. When the route has hydrated (its `wardic:ssr-hydrated` event), it reads each element
//    again: is it the same node, did hydration change its attributes (other than style),
//    what does the first paint after hydration show, and where does it settle.
// 3. Verdicts: MISMATCH when hydration replaced the node or changed its attributes; FLASH
//    when the first paint jumped away from the server's paint; MOVED when an element that
//    should hold still (`initial={false}`, #134) wasn't painted where it holds, or moved
//    in any frame after hydration; else OK.
//
// What each element should do is the example's (`reportWhenHydrated(expected)`): its route renders
// its own elements. "Save log" posts the rows to /api/save-log (the example's logs/, gitignored).

/** What the report expects of each `data-ssr-k` element. */
export interface SsrExpected {
  /** The server paints the Starting style on this element (else, by design, it doesn't). */
  readonly starting: boolean
  /** The settled opacity, if it animates. */
  readonly settledOpacity?: number
  /**
   * The opacity it holds from the server's paint on (`initial={false}`, #134): the server
   * paints it there, and it never moves after hydration.
   */
  readonly holds?: number
  /** Why a row is special, shown in the report. */
  readonly note?: string
}

interface Seen {
  readonly opacity: number
  readonly x: number
  readonly cx: number | undefined
  readonly text: string
}

interface Snapshot extends Seen {
  readonly node: Element
  readonly attrs: Readonly<Record<string, string>>
}

export interface ReportRow {
  readonly k: string
  readonly verdict: "OK" | "FLASH" | "MOVED" | "MISMATCH"
  readonly sameNode: boolean
  readonly attrsChanged: ReadonlyArray<string>
  readonly server: Seen
  readonly firstPaint: Seen | undefined
  readonly settled: Seen | undefined
  readonly note: string
}

const snapshots = new Map<string, Snapshot>()

/**
 * What the user sees of `el`: its opacity times its ancestors' (a component can carry the
 * Starting style on its root while the marked element is inside it), its left edge on
 * the page (every transform included), its SVG `cx`, and its text.
 */
const seen = (el: Element): Seen => {
  let opacity = 1
  for (let node: Element | null = el; node !== null; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
  const cx = el.getAttribute("cx")
  return {
    opacity,
    x: el.getBoundingClientRect().left,
    cx: cx === null ? undefined : Number(cx),
    text: el.textContent?.trim() ?? "",
  }
}

const attrsOf = (el: Element): Record<string, string> => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]))

/** Keep what the server's paint shows, before the app hydrates it. */
export const snapshotServerMarkup = (): void => {
  for (const el of document.querySelectorAll("[data-ssr-k]")) {
    snapshots.set(el.getAttribute("data-ssr-k")!, { node: el, attrs: attrsOf(el), ...seen(el) })
  }
}

/** Resolves with `read()` just before the next paint (a ResizeObserver runs after layout, before paint). */
const beforeNextPaint = <A>(read: () => A): Promise<A> =>
  new Promise((resolve) => {
    const probe = document.createElement("i")
    document.body.append(probe)
    const observer = new ResizeObserver(() => {
      observer.disconnect()
      const value = read()
      probe.remove()
      resolve(value)
    })
    observer.observe(probe)
  })

/** The least and most opacity and left edge an element showed. */
interface Range {
  readonly opacity: readonly [number, number]
  readonly x: readonly [number, number]
}

/** The range each of `keys` shows, read every frame for `ms`. */
const rangesOver = (keys: ReadonlyArray<string>, ms: number): Promise<ReadonlyMap<string, Range>> =>
  new Promise((resolve) => {
    const ranges = new Map<string, Range>()
    const end = performance.now() + ms
    const frame = (): void => {
      for (const k of keys) {
        const el = document.querySelector(`[data-ssr-k="${k}"]`)
        if (el === null) continue
        const s = seen(el)
        const r = ranges.get(k) ?? { opacity: [s.opacity, s.opacity], x: [s.x, s.x] }
        ranges.set(k, {
          opacity: [Math.min(r.opacity[0], s.opacity), Math.max(r.opacity[1], s.opacity)],
          x: [Math.min(r.x[0], s.x), Math.max(r.x[1], s.x)],
        })
      }
      if (performance.now() < end) requestAnimationFrame(frame)
      else resolve(ranges)
    }
    requestAnimationFrame(frame)
  })

/** Why an element that should hold at `holds` didn't: where the server painted it, or how far it moved. */
const holdFailures = (holds: number, server: Seen, firstPaint: Seen | undefined, range: Range | undefined): ReadonlyArray<string> => {
  const failures: Array<string> = []
  if (Math.abs(server.opacity - holds) > 0.02) failures.push(`the server painted opacity ${server.opacity.toFixed(2)}, not ${holds}`)
  const opacities = [firstPaint?.opacity ?? holds, ...(range?.opacity ?? [])]
  const xs = [firstPaint?.x ?? server.x, ...(range?.x ?? [])]
  const lo = Math.min(...opacities)
  const hi = Math.max(...opacities)
  if (Math.abs(lo - holds) > 0.02 || Math.abs(hi - holds) > 0.02) failures.push(`after hydration its opacity went ${lo.toFixed(2)}–${hi.toFixed(2)}`)
  const moved = Math.max(...xs.map((x) => Math.abs(x - server.x)))
  if (moved > 1) failures.push(`after hydration it moved ${moved.toFixed(0)} px from the server's paint`)
  return failures
}

/** Judge every snapshotted element once the route has hydrated, against what `expected` says of it. */
const judge = async (expected: Readonly<Record<string, SsrExpected>>): Promise<ReadonlyArray<ReportRow>> => {
  const now = (k: string) => document.querySelector(`[data-ssr-k="${k}"]`)
  // Right after hydration: identity and attributes.
  const afterHydrate = new Map([...snapshots.keys()].map((k) => [k, now(k)]))
  const firstPaint = await beforeNextPaint(() => new Map([...snapshots.keys()].map((k) => [k, now(k)] as const).map(([k, el]) => [k, el === null ? undefined : seen(el)])))
  const held = [...snapshots.keys()].filter((k) => expected[k]?.holds !== undefined)
  const ranges = await rangesOver(held, 2500)
  const rows: Array<ReportRow> = []
  for (const [k, snap] of snapshots) {
    const expects = expected[k] ?? { starting: false }
    const el = afterHydrate.get(k) ?? null
    const sameNode = el === snap.node
    const attrsChanged =
      el === null
        ? ["(gone)"]
        : [...new Set([...Object.keys(snap.attrs), ...Object.keys(attrsOf(el))])].filter(
          (a) => a !== "style" && a !== "cx" && a !== "opacity" && snap.attrs[a] !== el.getAttribute(a),
        )
    const fp = firstPaint.get(k)
    const settledEl = now(k)
    const settled = settledEl === null ? undefined : seen(settledEl)
    let verdict: ReportRow["verdict"] = "OK"
    let note = expects.note ?? ""
    if (!sameNode || attrsChanged.length > 0) verdict = "MISMATCH"
    else if (expects.starting && fp !== undefined) {
      const jumped =
        Math.abs(fp.opacity - snap.opacity) > 0.15 ||
        Math.abs(fp.x - snap.x) > 8 ||
        (fp.cx !== undefined && snap.cx !== undefined && Math.abs(fp.cx - snap.cx) > 12)
      if (jumped) verdict = "FLASH"
    }
    if (expects.holds !== undefined) {
      const failures = holdFailures(expects.holds, snap, fp, ranges.get(k))
      if (failures.length > 0 && verdict === "OK") verdict = "MOVED"
      note = [note, ...failures].filter(Boolean).join("; ")
    }
    if (k === "reduced-motion") {
      const live = String(matchMedia("(prefers-reduced-motion: reduce)").matches)
      if (snap.text !== "false") verdict = "MISMATCH"
      if (settled?.text !== live) {
        verdict = "MISMATCH"
        note = `${note}; expected ${live} after mount`
      }
    }
    if (expects.settledOpacity !== undefined && settled !== undefined && Math.abs(settled.opacity - expects.settledOpacity) > 0.02) {
      note = `${note}${note ? "; " : ""}not settled at opacity ${expects.settledOpacity}`
    }
    rows.push({ k, verdict, sameNode, attrsChanged, server: { opacity: snap.opacity, x: snap.x, cx: snap.cx, text: snap.text }, firstPaint: fp, settled, note })
  }
  return rows
}

const fmt = (s: Seen | undefined): string =>
  s === undefined ? "–" : `opacity ${s.opacity.toFixed(2)}, x ${s.x.toFixed(0)}${s.cx !== undefined ? `, cx ${s.cx.toFixed(0)}` : ""}${s.text.length <= 8 ? ` "${s.text}"` : ""}`

/** The panel: a row per element and Save log. Outside the hydrated tree. */
const renderPanel = (rows: ReadonlyArray<ReportRow>): void => {
  const panel = document.createElement("aside")
  panel.setAttribute("data-hydration-report", "")
  panel.style.cssText = "font: 13px/1.4 system-ui, sans-serif; margin: 1.5rem; padding: 1rem; border: 2px solid #333; border-radius: 8px; max-width: 60rem"
  const head = document.createElement("h2")
  head.textContent = `Hydration report: ${rows.filter((r) => r.verdict === "OK").length}/${rows.length} OK`
  head.style.margin = "0 0 .5rem"
  const table = document.createElement("table")
  table.style.borderCollapse = "collapse"
  const header = table.insertRow()
  for (const h of ["element", "verdict", "server paint", "first paint after hydration", "settled", "note"]) {
    const th = document.createElement("th")
    th.textContent = h
    th.style.cssText = "text-align: left; padding: 2px 8px; border-bottom: 1px solid #999"
    header.append(th)
  }
  for (const row of rows) {
    const tr = table.insertRow()
    for (const [i, text] of [row.k, row.verdict, fmt(row.server), fmt(row.firstPaint), fmt(row.settled), [row.note, row.attrsChanged.length > 0 ? `attributes changed: ${row.attrsChanged.join(", ")}` : "", row.sameNode ? "" : "node replaced"].filter(Boolean).join("; ")].entries()) {
      const td = tr.insertCell()
      td.textContent = text
      td.style.padding = "2px 8px"
      if (i === 1) td.style.color = row.verdict === "OK" ? "#070" : "#b00"
    }
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
          url: location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          mode: import.meta.env.DEV ? "dev" : "build",
          rows,
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
  panel.append(head, table, actions)
  document.body.append(panel)
}

/**
 * Judge the route once it has hydrated, against what `expected` says of each element, then show the
 * panel (and expose the rows for a headless check).
 */
export const reportWhenHydrated = (expected: Readonly<Record<string, SsrExpected>>): void => {
  if (snapshots.size === 0) return
  window.addEventListener(
    "wardic:ssr-hydrated",
    () => {
      void judge(expected).then((rows) => {
        ;(window as { __wardicSsrReport?: ReadonlyArray<ReportRow> }).__wardicSsrReport = rows
        renderPanel(rows)
      })
    },
    { once: true },
  )
}
