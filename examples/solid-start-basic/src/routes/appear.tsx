// /appear: Appear animations (#48, ADR-0044's hand check). Each element's mount animation is
// sampled on the server into the head's <style>, plays from first paint, and is taken over by the
// engine at hydration. `?hydrate=<ms>` delays hydration (entry-client.tsx), so the Handoff falls
// mid-flight; with JavaScript off, everything plays to its end and holds. The report
// (src/appear-report.ts) judges each element marked `data-appear-k` two seconds after hydration.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid"
import { For, type JSX, onMount } from "solid-js"

const box: JSX.CSSProperties = { width: "48px", height: "48px", background: "#3a7", "border-radius": "8px" }
const row: JSX.CSSProperties = { display: "flex", gap: "16px", "align-items": "center", margin: "12px 0" }
const label: JSX.CSSProperties = { font: "13px system-ui, sans-serif", width: "12rem" }

const items = { hidden: { opacity: 0, x: -40 }, shown: { opacity: 1, x: 0 } }

export default function AppearRoute(): JSX.Element {
  // The report judges once the route has mounted (src/appear-report.ts).
  onMount(() => window.dispatchEvent(new Event("wardic:appear-mounted")))
  return (
    <WardicProvider env={DomLive}>
      <main style={{ padding: "16px", "max-width": "28rem" }}>
        <h1 style={{ font: "600 18px system-ui, sans-serif" }}>Appear animations (#48)</h1>
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
          <span style={label}>appear=&#123;false&#125;: held until hydration</span>
          <wardic.div data-appear-k="held" data-appear-expect="held" style={box} appear={false} initial={{ opacity: 0.3, y: 20 }} animate={{ opacity: 1, y: 0 }} />
        </div>
      </main>
    </WardicProvider>
  )
}
