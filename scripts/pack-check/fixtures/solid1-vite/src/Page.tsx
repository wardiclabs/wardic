import { DomLive } from "@wardic/dom"
import { domAnimation, LazyWardic, w, WardicProvider } from "@wardic/solid"

/** An element that enters, and one whose `drag` is loaded lazily, as an app would write them. */
export function Page() {
  return (
    <WardicProvider env={DomLive} features={[domAnimation]} strict>
      <w.div id="enter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ width: "80px", height: "40px", background: "teal" }} />
      <LazyWardic features={() => import("./drag-feature.ts").then((m) => m.drag)}>
        <w.div id="drag" drag dragMomentum={false} style={{ width: "80px", height: "40px", background: "coral", "touch-action": "none" }} />
      </LazyWardic>
    </WardicProvider>
  )
}
