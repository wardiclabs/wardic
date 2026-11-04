import { Reorder } from "motion/react"
import { useState } from "react"

/** A list to put in order, by dragging a row. */
export default function Shelf() {
  const [rows, setRows] = useState(["Bowls", "Plates", "Cups", "Jugs"])
  return (
    <Reorder.Group axis="y" className="sample-list sample-reorder" values={rows} onReorder={setRows}>
      {rows.map((row) => (
        <Reorder.Item key={row} className="sample-row" value={row}>
          {row}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  )
}
