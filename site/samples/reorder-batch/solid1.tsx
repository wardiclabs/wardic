import { Reorder } from "@wardic/solid"
import { createSignal, For } from "solid-js"

const ROWS: ReadonlyArray<string> = Array.from({ length: 1000 }, (_, i) => `Row ${i + 1}`)

/** A thousand rows to put in order, one Batch for them all: drag a row, or focus it and lift it with Space, then use the arrows. */
export default function LongList() {
  const [rows, setRows] = createSignal(ROWS)
  return (
    // The list's scroll container: a row held near its edge scrolls it.
    <div class="sample-long-list">
      {/* A row's place comes from its index: one size and gap for every row, nothing measured. */}
      <Reorder.BatchGroup class="sample-batch-list" values={rows()} onReorder={setRows} itemSize={{ width: 240, height: 36 }} gap={6}>
        <For each={rows()}>
          {(row) => (
            <Reorder.BatchItem class="sample-batch-row" value={row}>
              {row}
            </Reorder.BatchItem>
          )}
        </For>
      </Reorder.BatchGroup>
    </div>
  )
}
