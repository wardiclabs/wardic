import { correctParentTransform, WardicConfig } from "@wardic/solid"
import { w } from "~/lib/wardic-drag.ts"
import { createSignal, For } from "solid-js"

const PIECES = [
  { id: "sofa", name: "Sofa", x: 24, y: 24, width: 120, height: 52 },
  { id: "table", name: "Table", x: 64, y: 112, width: 72, height: 44 },
  { id: "lamp", name: "Lamp", x: 236, y: 32, width: 44, height: 44 },
] as const

export default function ArrangeRoom() {
  // The plan is zoomed with a CSS transform, so the pointer moves in the page's pixels while a
  // piece moves in the plan's: at 140% a piece would run ahead of the pointer, at 60% lag behind.
  const [zoom, setZoom] = createSignal(1)
  let plan!: HTMLDivElement

  return (
    <div class="room-demo">
      <label class="room-zoom">
        <span>Zoom</span>
        <input type="range" min="0.6" max="1.4" step="0.1" value={zoom()} onInput={(event) => setZoom(Number(event.currentTarget.value))} />
        <output>{Math.round(zoom() * 100)}%</output>
      </label>
      <div class="room-frame">
        <div class="room-plan" ref={plan} style={{ transform: `scale(${zoom()})` }}>
          {/* correctParentTransform turns each pointer point back through the plan's zoom, so a piece
              stays under the pointer at any zoom, and its constraints are measured in the plan's pixels. */}
          <WardicConfig transformPagePoint={correctParentTransform(() => plan)}>
            <For each={PIECES}>
              {(piece) => (
                <w.div
                  class="room-piece"
                  data-id={piece.id}
                  drag
                  dragConstraints={() => plan}
                  dragElastic={0.1}
                  dragMomentum={false}
                  whileDrag={{ scale: 1.05 }}
                  style={{ left: `${piece.x}px`, top: `${piece.y}px`, width: `${piece.width}px`, height: `${piece.height}px` }}
                >
                  {piece.name}
                </w.div>
              )}
            </For>
          </WardicConfig>
        </div>
      </div>
    </div>
  )
}
