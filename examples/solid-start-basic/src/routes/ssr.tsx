// /ssr: every Wardic element kind rendered on the server, then hydrated (ADR-0021's hand
// check, #41). Each element starts at a VISIBLE Starting style (faded, offset), so a load
// with JavaScript disabled shows the server's paint; after hydration each animates to
// rest. Its provider sets `appear={false}` (#48): /appear checks what plays before hydration. The `initial={false}` elements (#134) start at their animate instead and never move.
// The hydration report (examples/hand-checks/src/hydration-report.ts, client-only) judges each element marked
// `data-ssr-k` against SSR_EXPECTED (src/ssr-expected.ts).
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  createReducedMotion,
  LayoutGroup,
  Reorder,
  createWard,
  wardic,
  WardicProvider,
  type WardicTransition,
} from "@wardic/solid"
import { createSignal, For, type JSX, onMount, Show } from "solid-js"

/** Slow enough to watch. */
const EASE: WardicTransition = { type: "tween", duration: 0.8 }
const FADED = { opacity: 0.25, x: -40 }
const REST = { opacity: 1, x: 0 }
/** Where the `initial={false}` elements (#134) start and stay: half faded and to the right. */
const HALF = { opacity: 0.5, x: 24 }

interface CardProps {
  readonly ref?: (el: HTMLElement) => void
  readonly style?: JSX.CSSProperties
  readonly draggable?: "false" | "true"
  readonly children?: JSX.Element
}
const cardStyle: JSX.CSSProperties = { padding: "8px 12px", border: "1px solid #888", "border-radius": "6px", margin: "6px 0" }

const RefAndStyle = (p: CardProps): JSX.Element => (
  <div data-ssr-k="card-root" ref={p.ref} style={{ ...cardStyle, ...p.style }} draggable={p.draggable}>
    {p.children}
  </div>
)
const RefOnly = (p: CardProps): JSX.Element => (
  <div data-ssr-k="card-ref" ref={p.ref} style={cardStyle}>
    {p.children}
  </div>
)
const StyleInner = (p: CardProps): JSX.Element => (
  <div ref={p.ref} style={cardStyle}>
    <span data-ssr-k="card-inner" style={{ display: "inline-block", ...p.style }}>
      {p.children}
    </span>
  </div>
)
const CardRoot = wardic.create(RefAndStyle)
const CardRef = wardic.create(RefOnly)
const CardInner = wardic.create(StyleInner)

function Spread(): JSX.Element {
  const ward = createWard({ initial: FADED, animate: REST, transition: EASE })
  return (
    <section data-ssr-k="spread" {...ward({ style: cardStyle })}>
      createWard spread on a section
    </section>
  )
}

function ReducedMotion(): JSX.Element {
  const reduced = createReducedMotion()
  return (
    <p>
      createReducedMotion(): <code data-ssr-k="reduced-motion">{String(reduced())}</code>
      <Show when={!reduced()}>
        <em> (motion allowed)</em>
      </Show>
    </p>
  )
}

const VALUES = ["one", "two", "three"]

export default function SsrCheck(): JSX.Element {
  const [shown, setShown] = createSignal(true)
  const [heldShown, setHeldShown] = createSignal(true)
  const [wide, setWide] = createSignal(false)
  const [items, setItems] = createSignal(VALUES)
  // Tell the hydration report this route has hydrated (client only: onMount never runs
  // on a server). A microtask, so every element's own mount has run first.
  onMount(() => queueMicrotask(() => window.dispatchEvent(new Event("wardic:ssr-hydrated"))))
  return (
    // `appear={false}`: this route checks the Hydration hold (ADR-0021), each element at its Starting
    // style until mount; /appear checks the Appear animations (#48) that otherwise play before it.
    <WardicProvider env={DomLive} appear={false}>
      <main style={{ "font-family": "system-ui, sans-serif", padding: "1.5rem", "max-width": "44rem" }}>
        <h1>Server render, then hydration (#41)</h1>
        <p>
          Every element below starts faded and to the left, as the server rendered it. With JavaScript off,
          that's what you see; with it on, each moves to rest once it hydrates.
        </p>

        <wardic.div data-ssr-k="div" style={cardStyle} initial={FADED} animate={REST} transition={EASE}>
          wardic.div
        </wardic.div>

        <Spread />

        <CardRoot initial={FADED} animate={REST} transition={EASE}>
          wardic.create(Card): ref and style on its root
        </CardRoot>
        <CardRef initial={FADED} animate={REST} transition={EASE}>
          wardic.create(Card): ref only (no server Starting style, by design)
        </CardRef>
        <CardInner initial={FADED} animate={REST} transition={EASE}>
          wardic.create(Card): style on an inner element
        </CardInner>

        <wardic.div data-ssr-k="drag" style={cardStyle} drag="x" initial={FADED} animate={REST} transition={EASE}>
          drag me along x
        </wardic.div>

        <Reorder.Group data-ssr-k="reorder" values={items()} onReorder={setItems} style={{ padding: "0", "list-style": "none" }}>
          <For each={items()}>
            {(value) => (
              <Reorder.Item value={value} style={cardStyle}>
                {value}
              </Reorder.Item>
            )}
          </For>
        </Reorder.Group>

        <svg width="220" height="40" style={{ border: "1px solid #ccc", "border-radius": "6px" }}>
          <wardic.circle data-ssr-k="circle" r={12} cy={20} fill="#4a7" initial={{ cx: 20, opacity: 0.25 }} animate={{ cx: 180, opacity: 1 }} transition={EASE} />
        </svg>

        <p>
          <button type="button" onClick={() => setShown((s) => !s)}>
            toggle the AnimatePresence child
          </button>
        </p>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-ssr-k="presence" style={cardStyle} initial={{ opacity: 0.25, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={EASE}>
              an AnimatePresence child
            </wardic.div>
          </Show>
        </AnimatePresence>

        <p>
          <button type="button" onClick={() => setWide((w) => !w)}>
            resize the layout element
          </button>
        </p>
        <LayoutGroup>
          <wardic.div
            data-ssr-k="layout"
            layout
            style={{ ...cardStyle, width: wide() ? "100%" : "40%" }}
            initial={{ opacity: 0.25 }}
            animate={{ opacity: 1 }}
            transition={EASE}
          >
            a layout element
          </wardic.div>
        </LayoutGroup>

        <h2>initial={"{false}"} (#134)</h2>
        <p>
          These three start at their animate, half faded and to the right, in the server's paint, and never move. Toggled
          out and back in, the AnimatePresence child is a later entry: it fades in.
        </p>

        <wardic.div data-ssr-k="held" style={cardStyle} initial={false} animate={HALF} transition={EASE}>
          {"wardic.div initial={false}"}
        </wardic.div>

        <wardic.div initial={false} animate="half" variants={{ half: {} }}>
          <wardic.div data-ssr-k="held-variant" style={cardStyle} variants={{ half: HALF }} transition={EASE}>
            {"a Variant child of an initial={false} parent"}
          </wardic.div>
        </wardic.div>

        <p>
          <button type="button" onClick={() => setHeldShown((s) => !s)}>
            {"toggle the AnimatePresence initial={false} child"}
          </button>
        </p>
        <AnimatePresence initial={false}>
          <Show when={heldShown()}>
            <wardic.div data-ssr-k="held-presence" style={cardStyle} initial={FADED} animate={HALF} exit={{ opacity: 0, x: -40 }} transition={EASE}>
              {"an AnimatePresence initial={false} child"}
            </wardic.div>
          </Show>
        </AnimatePresence>

        <ReducedMotion />
      </main>
    </WardicProvider>
  )
}
