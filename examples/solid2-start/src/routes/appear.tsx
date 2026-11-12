// /appear: Appear animations (#48, ADR-0044's hand check), on the Solid 2 binding: the Solid 1
// example's /appear. Each element's mount animation is sampled on the server into the head's
// <style> (Solid 2's head registry), plays from first paint, and is taken over by the engine at
// hydration. `?hydrate=<ms>` delays hydration (entry-client.tsx), so the Handoff falls mid-flight;
// with JavaScript off, everything plays to its end and holds. `?data=<ms>` (default 400) is when the
// streamed list's data resolves on the server: its items come in a late `<Loading>` chunk, with their
// rules as a head patch (#245). The report (examples/hand-checks/src/appear-report.ts) judges each
// element marked `data-appear-k` two seconds after hydration.
import { DomLive } from "@wardic/dom"
import { createBatch, Reorder, stagger, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { useLocation } from "@solidjs/router"
import { type JSX, Loading } from "@solidjs/web"
import { createMemo, createSignal, For, onSettled } from "solid-js"

const box: JSX.CSSProperties = { width: "48px", height: "48px", background: "#3a7", "border-radius": "8px" }
const row: JSX.CSSProperties = { display: "flex", gap: "16px", "align-items": "center", margin: "12px 0" }
const label: JSX.CSSProperties = { font: "13px system-ui, sans-serif", width: "12rem" }

const items = { hidden: { opacity: 0, x: -40 }, shown: { opacity: 1, x: 0 } }

/** The Batch's tiles (#706): twelve in two rows, each from the middle to its place, fading in. */
const TILES = Array.from({ length: 12 }, (_, i) => i)
const tile: JSX.CSSProperties = { position: "absolute", left: "0", top: "0", width: "22px", height: "22px", background: "#a63", "border-radius": "4px" }
/** The Batch Reorder group's items (#706). */
const GROUPED = ["a", "b", "c", "d"]

/** The Batch's tiles (#706), its entrance an Appear animation, asked for: under the provider, as a Batch is made. */
function BatchTiles(): JSX.Element {
  const tiles = createBatch({
    appear: true,
    count: TILES.length,
    initial: { x: 72, y: 13, opacity: 0, scale: 0.5 },
    animate: (i) => ({ x: (i % 6) * 28, y: Math.floor(i / 6) * 26, opacity: 1, scale: 1 }),
    transition: { type: "spring", stiffness: 160, damping: 18, delay: stagger(0.06) },
  })
  return <For each={TILES}>{(i) => <div data-appear-k={`tile${i}`} {...tiles.at(i, { style: tile })} />}</For>
}

export default function AppearRoute(): JSX.Element {
  // The layout card's spacer (#245): Move it grows it, a layout change the card animates.
  const [moved, setMoved] = createSignal(false)
  // The streamed list's items (#245): resolved on the server `?data=<ms>` in, after the shell. The
  // page hydrates with the server's value.
  const location = useLocation()
  const streamed = createMemo(async (): Promise<ReadonlyArray<number>> => {
    const dataMs = Number.parseInt(new URLSearchParams(location.search).get("data") ?? "400", 10)
    await new Promise((resolve) => setTimeout(resolve, dataMs))
    return [0, 1, 2, 3]
  })
  // The report judges once the route has mounted (examples/hand-checks/src/appear-report.ts).
  onSettled(() => void window.dispatchEvent(new Event("wardic:appear-mounted")))
  return (
    <WardicProvider env={DomLive}>
      <main style={{ padding: "16px", "max-width": "28rem" }}>
        <h1 style={{ font: "600 18px system-ui, sans-serif" }}>Appear animations (#48), on Solid 2</h1>
        <p style={{ font: "13px system-ui, sans-serif" }}>
          Reload with <code>?hydrate=1500</code> to hydrate mid-flight, or with JavaScript off to see the CSS alone.
        </p>

        <div style={row}>
          <span style={label}>spring, rising in</span>
          <wardic.div data-appear-k="spring" style={box} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ stiffness: 120, damping: 14 }} />
        </div>

        <div style={row}>
          <span style={label}>tween, 2.5 s across</span>
          <div style={{ width: "160px" }}>
            <wardic.div
              data-appear-k="tween"
              style={{ ...box, width: "24px", height: "24px" }}
              initial={{ x: 0, opacity: 0.2 }}
              animate={{ x: 136, opacity: 1 }}
              transition={{ type: "tween", duration: 2.5 }}
            />
          </div>
        </div>

        <div style={row}>
          <span style={label}>a stagger of four</span>
          <wardic.ul
            style={{ margin: 0, padding: 0, "list-style": "none", display: "flex", gap: "6px" }}
            initial="hidden"
            animate="shown"
            variants={{ hidden: {}, shown: {} }}
            transition={{ type: "tween", duration: 0.6, staggerChildren: 0.25 }}
          >
            <For each={[0, 1, 2, 3]}>{(i) => <wardic.li data-appear-k={`item${i}`} style={{ ...box, width: "20px", height: "20px" }} variants={items} />}</For>
          </wardic.ul>
        </div>

        <div style={row}>
          <span style={label}>a parent, then its child</span>
          <wardic.section
            data-appear-k="parent"
            style={{ padding: "6px", border: "1px solid #888", "border-radius": "6px" }}
            initial="hidden"
            animate="shown"
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
            transition={{ type: "tween", duration: 0.8, when: "beforeChildren" }}
          >
            <wardic.div data-appear-k="child" style={{ ...box, width: "24px", height: "24px" }} variants={{ hidden: { y: 20, opacity: 0 }, shown: { y: 0, opacity: 1 } }} transition={{ type: "tween", duration: 0.6 }} />
          </wardic.section>
        </div>

        <div style={row}>
          <span style={label}>a spinner, for ever</span>
          <wardic.div
            data-appear-k="spinner"
            data-appear-positional
            style={{ ...box, width: "28px", height: "28px", "border-radius": "4px" }}
            initial={{ rotate: 0 }}
            animate={{ rotate: 360 }}
            transition={{ type: "tween", duration: 1.2, repeat: Number.POSITIVE_INFINITY }}
          />
        </div>

        <div style={row}>
          <span style={label}>SVG: a circle grows across, a line draws (#245)</span>
          <svg width="140" height="40" style={{ overflow: "visible" }}>
            <wardic.circle
              data-appear-k="svg-circle"
              fill="#3a7"
              initial={{ cx: 12, r: 4, opacity: 0.2 }}
              animate={{ cx: 120, r: 14, opacity: 1 }}
              transition={{ type: "tween", duration: 2 }}
            />
            <wardic.path
              data-appear-k="svg-line"
              d="M0 36L140 36"
              stroke="#333"
              stroke-width="3"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ type: "tween", duration: 2 }}
            />
          </svg>
        </div>

        <div style={row}>
          <span style={label}>a layout card: scale and fade, its y not drawn (#245)</span>
          <div>
            <div style={{ width: `${Number(moved()) * 60}px`, display: "inline-block" }} />
            <wardic.div
              data-appear-k="layout"
              layout
              layoutDependency={moved()}
              style={{ ...box, display: "inline-block" }}
              initial={{ opacity: 0, scale: 0.5, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "tween", duration: 1.5 }}
            />
          </div>
          <button type="button" onClick={() => setMoved(!moved())}>
            Move it
          </button>
        </div>

        <div style={row}>
          <span style={label}>a list streamed after the page (#245): ?data=&lt;ms&gt;</span>
          <wardic.ul
            style={{ margin: 0, padding: 0, "list-style": "none", display: "flex", gap: "6px", "min-height": "20px" }}
            initial="hidden"
            animate="shown"
            variants={{ hidden: {}, shown: {} }}
            transition={{ type: "tween", duration: 0.6, staggerChildren: 0.2 }}
          >
            <Loading fallback={<li style={{ font: "12px system-ui, sans-serif" }}>loading…</li>}>
              <For each={streamed()}>
                {(i) => <wardic.li data-appear-k={`late${i}`} style={{ ...box, width: "20px", height: "20px", background: "#c63" }} variants={items} />}
              </For>
            </Loading>
          </wardic.ul>
        </div>

        <div style={row}>
          <span style={label}>a Batch, appear: twelve tiles staggered in (#706)</span>
          <div style={{ position: "relative", width: "168px", height: "48px" }}>
            <BatchTiles />
          </div>
        </div>

        <div style={row}>
          <span style={label}>a Batch Reorder group, appear: fading in at its places (#706)</span>
          <Reorder.BatchGroup appear values={GROUPED} onReorder={() => {}} axis="x" itemSize={{ width: 28, height: 28 }} gap={6} initial={{ opacity: 0, scale: 0.6 }} transition={{ type: "tween", duration: 1.2 }}>
            <For each={GROUPED}>{(v) => <Reorder.BatchItem value={v} data-appear-k={`group-${v}`} style={{ background: "#37a", "border-radius": "6px" }} />}</For>
          </Reorder.BatchGroup>
        </div>

        <div style={row}>
          <span style={label}>appear=&#123;false&#125;: held until hydration</span>
          <wardic.div data-appear-k="held" data-appear-expect="held" style={box} appear={false} initial={{ opacity: 0.3, y: 20 }} animate={{ opacity: 1, y: 0 }} />
        </div>
      </main>
    </WardicProvider>
  )
}
