import type { Html, HtmlBuilder } from "foldkit/html"
import { wardic } from "~/lib/wardic.ts"

/** A card that rises into place as it mounts, and lifts under the pointer. */
export const view = <Message,>(h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  return w.div(
    [
      h.Class("sample-card"),
      w.Initial({ opacity: 0, y: 24 }),
      w.Animate({ opacity: 1, y: 0 }),
      w.WhileHover({ y: -4, scale: 1.02 }),
      w.Transition({ type: "spring", stiffness: 260, damping: 22 }),
    ],
    ["Hello, Wardic"],
  )
}
