/**
 * The Reorder guide's long list (#712): 1,000 items in one `Reorder.BatchGroup`, as the code tabs' column
 * of rows, or as a grid of tiles whose columns come from its width. Not a code tab: the tabs show the
 * column alone.
 */
import { Reorder } from "@wardic/solid/unstable/v2"
import { createSignal, For, onSettled, Show } from "solid-js"
import { framesPerSecond } from "../frames.ts"

type Shape = "column" | "grid"

const SHAPES: ReadonlyArray<{ readonly shape: Shape; readonly label: string }> = [
  { shape: "column", label: "Column" },
  { shape: "grid", label: "Grid" },
]

const ROWS: ReadonlyArray<string> = Array.from({ length: 1000 }, (_, i) => `Row ${i + 1}`)
const TILES: ReadonlyArray<number> = Array.from({ length: 1000 }, (_, i) => i + 1)

export default function Demo() {
  const [shape, setShape] = createSignal<Shape>("column")
  const [rows, setRows] = createSignal(ROWS)
  const [tiles, setTiles] = createSignal(TILES)
  const [fps, setFps] = createSignal<number>()
  onSettled(() => framesPerSecond(setFps))
  return (
    <div class="sample-stack">
      <div class="sample-tabs" role="group" aria-label="The list's shape">
        <For each={SHAPES}>
          {(choice) => (
            <button class="sample-tab" aria-pressed={shape() === choice.shape ? "true" : "false"} onClick={() => setShape(choice.shape)}>
              {choice.label}
            </button>
          )}
        </For>
      </div>
      <div class="sample-long-list">
        <Show
          when={shape() === "grid"}
          fallback={
            <Reorder.BatchGroup class="sample-batch-list" values={rows()} onReorder={setRows} itemSize={{ width: 240, height: 36 }} gap={6}>
              <For each={rows()}>
                {(row) => (
                  <Reorder.BatchItem class="sample-batch-row" value={row}>
                    {row}
                  </Reorder.BatchItem>
                )}
              </For>
            </Reorder.BatchGroup>
          }
        >
          {/* No `columns`: as many as the group's width holds, read again as it's resized. */}
          <Reorder.BatchGroup class="sample-batch-list" axis="xy" values={tiles()} onReorder={setTiles} itemSize={{ width: 32, height: 32 }} gap={4}>
            <For each={tiles()}>
              {(tile) => (
                <Reorder.BatchItem class="sample-batch-tile" value={tile} style={{ "--hue": `hsl(${190 + tile * 0.15} 60% 62%)` }}>
                  {tile}
                </Reorder.BatchItem>
              )}
            </For>
          </Reorder.BatchGroup>
        </Show>
      </div>
      <p class="sample-note">1,000 items · {fps() ?? "–"} fps</p>
    </div>
  )
}
