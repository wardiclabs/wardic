import { DomLive } from "@wardic/dom"
import { domAnimation, drag, LazyWardic, w, WardicProvider } from "@wardic/solid"
import { createComponent, render } from "solid-js/web"

// The page Page.tsx writes in JSX, written with `createComponent`, so no JSX compile runs here.
const box = (background: string) => ({ width: "80px", height: "40px", background, "touch-action": "none" })

render(
  () =>
    createComponent(WardicProvider, {
      env: DomLive,
      features: [domAnimation],
      strict: true,
      get children() {
        return [
          createComponent(w.div, { id: "enter", initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3 }, style: box("teal") }),
          createComponent(LazyWardic, {
            features: () => Promise.resolve(drag),
            get children() {
              return createComponent(w.div, { id: "drag", drag: true, dragMomentum: false, style: box("coral") })
            },
          }),
        ]
      },
    }),
  document.getElementById("app")!,
)
