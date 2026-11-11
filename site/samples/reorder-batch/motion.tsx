import { Reorder } from "motion/react"
import { useState } from "react"

const ROWS = Array.from({ length: 1000 }, (_, i) => `Row ${i + 1}`)

/** A thousand rows to put in order, by dragging a row. */
export default function LongList() {
  const [rows, setRows] = useState(ROWS)
  return (
    // The list's scroll container: a row held near its edge scrolls it.
    <div className="sample-long-list">
      {/* Each row is its own element with a drag and a layout animation, all measured as a row crosses another. */}
      <Reorder.Group axis="y" className="sample-batch-list sample-batch-motion" values={rows} onReorder={setRows}>
        {rows.map((row) => (
          <Reorder.Item key={row} className="sample-batch-row" value={row}>
            {row}
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  )
}
