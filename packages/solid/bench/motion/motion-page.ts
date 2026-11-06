// `bench:motion`'s Motion side: React 19 with framer-motion's `motion.div`, or plain React divs with `?kind=plain`.
// Each update is rendered with `flushSync`, so its render, commit and effects run in the timed task.
import { motion } from "framer-motion"
import { createElement as h, Fragment, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { addStyle, atIn, install } from "./timing.ts"

const params = new URLSearchParams(location.search)
const n = Number(params.get("n") ?? "1000")
const kind = params.get("kind") ?? "motion"
const items = Array.from({ length: n }, (_, i) => i)
/** Each `?kind`'s element: Motion's `motion.div`, else a plain React div. */
const ITEMS: Record<string, (i: number, target: { readonly o: number; readonly c: string }) => ReturnType<typeof h>> = {
  plain: (i, target) => h("div", { key: i, className: "b", style: { opacity: target.o, backgroundColor: target.c } }),
  motion: (i, target) => h(motion.div, { key: i, className: "b", initial: { opacity: 0, backgroundColor: "rgb(0, 0, 0)" }, animate: { opacity: target.o, backgroundColor: target.c } }),
}
const host = addStyle()
let setShown: (shown: boolean) => void = () => {}
let setTarget: (t: { o: number; c: string }) => void = () => {}
const App = () => {
  const [shown, s1] = useState(false)
  const [target, s2] = useState({ o: 1, c: "rgb(255, 255, 255)" })
  setShown = s1
  setTarget = s2
  if (!shown) return null
  return h(
    Fragment,
    null,
    items.map((i) => (ITEMS[kind] ?? ITEMS.motion!)(i, target)),
  )
}
const root = createRoot(host)
flushSync(() => root.render(h(App)))
install(n, {
  show: (shown) => flushSync(() => setShown(shown)),
  target: (o, c) => flushSync(() => setTarget({ o, c })),
  count: () => host.querySelectorAll(".b").length,
  at: (o, c) => atIn(host, o, c),
})
