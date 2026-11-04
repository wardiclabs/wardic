import { Reorder } from "@wardic/solid"
import { createSignal, For } from "solid-js"

/** A list to put in order: drag a row, or focus it and lift it with Space, then use the arrows. */
export default function Shelf() {
  const [rows, setRows] = createSignal(["Bowls", "Plates", "Cups", "Jugs"])
  return (
    // An item brings its own drag and layout: no Feature to add.
    <Reorder.Group class="sample-list sample-reorder" values={rows()} onReorder={setRows}>
      <For each={rows()}>
        {(row) => (
          <Reorder.Item class="sample-row" value={row}>
            {row}
          </Reorder.Item>
        )}
      </For>
    </Reorder.Group>
  )
}
