"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { m } from "motion/react"
import { Tabs } from "radix-ui"
import { Suspense, use, useState } from "react"

// A panel fades up in as its tab is chosen: Radix mounts it then.
const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "tween", duration: 0.2 },
} as const

// The piece's details, in its catalog's order: its size, its material, its care.
const TABS = ["Size", "Material", "Care"]

export function DetailsTabs({ piece }: { readonly piece: Promise<Product> }) {
  return (
    <Suspense fallback={<p className="muted">Loading the piece…</p>}>
      <Details piece={piece} />
    </Suspense>
  )
}

function Details(props: { readonly piece: Promise<Product> }) {
  const piece = use(props.piece)
  const [tab, setTab] = useState("Size")
  const photo = photoOf("moon-vase")
  return (
    <article className="product-page details-tabs">
      <div className="photo">
        <img src={photo.small} srcSet={srcsetOf(photo)} sizes="(max-width: 720px) 100vw, 420px" width={photo.width} height={photo.height} alt={piece.name} />
      </div>
      <div className="product-info">
        <h2 className="name">{piece.name}</h2>
        <p className="price">{formatPrice(piece.price)}</p>
        {/* Radix's tabs: the arrow keys, Home and End, one tab in the Tab order, and the roles. */}
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="tabs" aria-label="About this piece">
            {TABS.map((name) => (
              <Tabs.Trigger key={name} className="tab" value={name}>
                {name}
                {/* One underline, inside whichever trigger is selected: its layoutId carries it from tab to tab. */}
                {tab === name && <m.span className="tab-indicator" layoutId="details-underline" />}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {TABS.map((name, index) => (
            <Tabs.Content key={name} value={name} asChild>
              <m.div className="tab-panel" {...fadeIn}>
                {piece.details[index]}
              </m.div>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </div>
    </article>
  )
}
