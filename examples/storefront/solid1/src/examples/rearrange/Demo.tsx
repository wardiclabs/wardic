import { LazyWardic, w } from "@wardic/solid"
import { createSignal, For, Show } from "solid-js"

const PIECES = [
  { id: "sofa", name: "Sofa", x: 24, y: 24, width: 120, height: 52 },
  { id: "table", name: "Table", x: 64, y: 112, width: 72, height: 44 },
  { id: "lamp", name: "Lamp", x: 236, y: 32, width: 44, height: 44 },
] as const

type Piece = (typeof PIECES)[number]

/** How long "Slow connection" holds the import back: long enough to try a drag before `drag` arrives. */
const HOLD_MS = 1500

const placeOf = (piece: Piece) => ({ left: `${piece.x}px`, top: `${piece.y}px`, width: `${piece.width}px`, height: `${piece.height}px` })

export default function Rearrange() {
  const [wanted, setWanted] = createSignal(false)
  const [slow, setSlow] = createSignal(false)
  // How long `drag` took to arrive, from the press: absent until it has.
  const [arrivedIn, setArrivedIn] = createSignal<number>()
  let plan!: HTMLDivElement
  let pressedAt = 0
  let held = false

  const rearrange = () => {
    pressedAt = performance.now()
    held = slow()
    setWanted(true)
  }

  // The section's Features, loaded as it renders: it renders on the press, so that's when the page
  // fetches `drag`. A page that has fetched it once, this one or another, has it at once.
  const loadDrag = async () => {
    if (held) await new Promise((resolve) => setTimeout(resolve, HOLD_MS))
    const { drag } = await import("~/lib/drag-feature.ts")
    setArrivedIn(Math.round(performance.now() - pressedAt))
    return drag
  }

  const state = () => {
    if (!wanted()) return "still"
    if (arrivedIn() === undefined) return "loading"
    return "arrived"
  }

  return (
    <div class="room-demo">
      <div class="lazy-bar">
        <button class="button accent rearrange" disabled={wanted()} onClick={rearrange}>
          Rearrange
        </button>
        <label class="switch">
          <input type="checkbox" checked={slow()} disabled={wanted()} onChange={(event) => setSlow(event.currentTarget.checked)} />
          <span>Slow connection</span>
        </label>
        <output class="lazy-status" aria-live="polite">
          <Show when={wanted()} fallback={<><code>drag</code> isn't loaded: the pieces stay put.</>}>
            <Show when={arrivedIn() !== undefined} fallback={<>Loading <code>drag</code>… a drag now does nothing.</>}>
              <code>drag</code> arrived in {arrivedIn()} ms.
            </Show>
          </Show>
        </output>
      </div>
      <div class="room-frame">
        <div class="room-plan" ref={plan} data-drag={state()}>
          <Show when={wanted()} fallback={<For each={PIECES}>{(piece) => <div class="room-piece" data-id={piece.id} style={placeOf(piece)}>{piece.name}</div>}</For>}>
            {/* The section that brings `drag`, lazily: until it arrives, the pieces' drag props do nothing. */}
            <LazyWardic features={loadDrag}>
              <For each={PIECES}>
                {(piece) => (
                  <w.div class="room-piece" data-id={piece.id} drag dragConstraints={() => plan} dragElastic={0.1} dragMomentum={false} whileDrag={{ scale: 1.05 }} style={placeOf(piece)}>
                    {piece.name}
                  </w.div>
                )}
              </For>
            </LazyWardic>
          </Show>
        </div>
      </div>
    </div>
  )
}
