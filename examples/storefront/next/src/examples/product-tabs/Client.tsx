"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, m } from "motion/react"
import { Suspense, use, useState } from "react"

const TABS = ["Description", "Details", "Delivery"] as const
type Tab = (typeof TABS)[number]

// The panel that's going fades up and out, then the next fades up in (mode="wait").
const panel = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: "tween", duration: 0.18 },
} as const

export function ProductTabs({ piece }: { readonly piece: Promise<Product> }) {
  return (
    <Suspense fallback={<p className="muted">Loading the piece…</p>}>
      <ProductPage piece={piece} />
    </Suspense>
  )
}

function ProductPage(props: { readonly piece: Promise<Product> }) {
  const piece = use(props.piece)
  const [tab, setTab] = useState<Tab>("Description")
  const photo = photoOf("lagoon-vase")
  return (
    <article className="product-page">
      <div className="photo">
        <img src={photo.small} srcSet={srcsetOf(photo)} sizes="(max-width: 720px) 100vw, 420px" width={photo.width} height={photo.height} alt={piece.name} />
      </div>
      <div className="product-info">
        <h2 className="name">{piece.name}</h2>
        <p className="price">{formatPrice(piece.price)}</p>
        <div className="tabs" role="tablist" aria-label="About this piece">
          {TABS.map((name) => (
            <button key={name} className="tab" role="tab" aria-selected={tab === name} aria-controls="piece-panel" onClick={() => setTab(name)}>
              {name}
              {/* One indicator, under whichever tab is selected: its layoutId carries it from tab to tab. */}
              {tab === name && <m.span className="tab-indicator" layoutId="tab-indicator" />}
            </button>
          ))}
        </div>
        <div className="tab-panel" id="piece-panel" role="tabpanel" aria-label={tab}>
          <AnimatePresence mode="wait" initial={false}>
            {/* A new key for each tab: the last panel leaves before the next enters. */}
            <m.div key={tab} {...panel}>
              <PanelFor tab={tab} piece={piece} />
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </article>
  )
}

function PanelFor({ tab, piece }: { readonly tab: Tab; readonly piece: Product }) {
  if (tab === "Details")
    return (
      <ul className="details">
        {piece.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    )
  if (tab === "Delivery") return <p>Ships in two to three working days, wrapped in recycled paper. Delivery is free over $100, and you can return a piece within 30 days, unused and in its box.</p>
  return <p>{piece.description}</p>
}
