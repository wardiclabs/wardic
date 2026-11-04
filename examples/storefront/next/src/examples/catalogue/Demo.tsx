"use client"
/**
 * The catalogue and a piece's page, two routes under one layout (#479), in Motion: the layout
 * (`app/transitions/catalogue/layout.tsx`) renders `Catalogue` around its pages, `page.tsx` the
 * `CatalogueList`, and `[id]/page.tsx` a `CataloguePiece` (`./Pages.tsx`).
 */
import { AnimatePresence, m } from "motion/react"
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { useSelectedLayoutSegment } from "next/navigation"
import { type ReactNode, useContext, useState } from "react"

/**
 * The router as it was when the page mounted: Next's `LayoutRouterContext` (an internal, not a public
 * API), kept, so a leaving page goes on rendering its own route while it exits, not the next one.
 */
function FrozenRouter({ children }: { readonly children: ReactNode }) {
  const context = useContext(LayoutRouterContext)
  const [frozen] = useState(context)
  return <LayoutRouterContext.Provider value={frozen}>{children}</LayoutRouterContext.Provider>
}

/**
 * The layout: a presence around its pages. React reuses an element of the same type, so the page is
 * keyed on the route's segment: another route is another element, and the one before leaves.
 * `popLayout` takes it out of the flow where it was, so the next one is in place at once and a shared
 * `layoutId` flies between them.
 */
export default function Catalogue({ children }: { readonly children: ReactNode }) {
  const segment = useSelectedLayoutSegment() ?? "catalogue"
  return (
    <div className="catalogue">
      <AnimatePresence mode="popLayout">
        <m.div key={segment} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.25 }}>
          <FrozenRouter>{children}</FrozenRouter>
        </m.div>
      </AnimatePresence>
    </div>
  )
}
