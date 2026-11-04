import { stagger, w } from "@wardic/solid"
import { createSignal, For } from "solid-js"

const ITEMS = ["Vases", "Bowls", "Plates", "Jugs"]

// The list names a variant; each item follows it with its own target. The list's transition spaces
// them out: in from the first, out from the last.
const list = {
  open: { transition: { delayChildren: stagger(0.07) } },
  closed: { transition: { delayChildren: stagger(0.05, { from: "last" }) } },
}
const item = {
  open: { opacity: 1, x: 0 },
  closed: { opacity: 0, x: -24 },
}

export default function Variants() {
  const [open, setOpen] = createSignal(true)
  return (
    <div class="sample-stack">
      <button class="sample-button" onClick={() => setOpen(!open())}>
        {open() ? "Close" : "Open"}
      </button>
      <w.ul class="sample-list" variants={list} initial="closed" animate={open() ? "open" : "closed"}>
        <For each={ITEMS}>{(name) => <w.li class="sample-item" variants={item}>{name}</w.li>}</For>
      </w.ul>
    </div>
  )
}
