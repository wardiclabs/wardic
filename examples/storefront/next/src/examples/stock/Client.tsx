"use client"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { motion } from "motion/react"
import { Suspense, use, useState, useTransition } from "react"
import { getStock } from "~/lib/store.ts"

/** When the stock is counted: now, or after the next delivery. */
type When = "now" | "delivery"
type Counts = Readonly<Record<string, number>>

/** A shelf holds eight of a piece: a full meter. */
const SHELF = 8

const PIECES = PRODUCTS.filter((product) => ["blossom-jar", "bottle-vase", "tulip-bowl", "lagoon-vase"].includes(product.id))

const FILL = { type: "spring", stiffness: 140, damping: 22 } as const

export function Stock({ now }: { readonly now: Promise<Counts> }) {
  const [when, setWhen] = useState<When>("now")
  // One count per `when`, kept: `use` needs the same promise each render. The server started "now".
  const [counts, setCounts] = useState<Partial<Record<When, Promise<Counts>>>>({ now })
  // A switch is a transition: the bars stay where they are until the new count has arrived.
  const [checking, startChecking] = useTransition()
  const choose = (next: When) =>
    startChecking(() => {
      setWhen(next)
      if (counts[next] === undefined) setCounts({ ...counts, [next]: getStock(next) })
    })
  return (
    <div className="stock">
      <div className="stock-head">
        <div className="segmented" role="group" aria-label="When">
          <button aria-pressed={when === "now"} onClick={() => choose("now")}>
            Now
          </button>
          <button aria-pressed={when === "delivery"} onClick={() => choose("delivery")}>
            After the delivery
          </button>
        </div>
      </div>
      {/* The first count waits as a skeleton. */}
      <Suspense fallback={<Skeleton />}>
        <Rows counts={counts[when] ?? now} checking={checking} />
      </Suspense>
    </div>
  )
}

function Rows({ counts, checking }: { readonly counts: Promise<Counts>; readonly checking: boolean }) {
  const levels = use(counts)
  return (
    <>
      <p className="stock-status muted" aria-live="polite">
        {checking ? "Checking the store…" : "The store's count"}
      </p>
      <ul className="stock-list">
        {PIECES.map((piece) => (
          <StockRow key={piece.id} piece={piece} left={levels[piece.id] ?? 0} />
        ))}
      </ul>
    </>
  )
}

function StockRow({ piece, left }: { readonly piece: Product; readonly left: number }) {
  // Motion tells an animation's start and end through callbacks: "filling…" between them, then the
  // count once it lands.
  const [filling, setFilling] = useState(true)
  return (
    <li className="stock-row">
      <img src={photoOf(piece.id).small} width="48" height="48" alt="" />
      <span className="name">{piece.name}</span>
      <span className="meter">
        <motion.span
          className="meter-fill"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: left / SHELF }}
          transition={FILL}
          onAnimationStart={() => setFilling(true)}
          onAnimationComplete={() => setFilling(false)}
        />
      </span>
      <span className="stock-label">{filling ? "filling…" : `✓ ${left} left`}</span>
    </li>
  )
}

function Skeleton() {
  return (
    <ul className="stock-list" aria-busy="true">
      {PIECES.map((piece) => (
        <li key={piece.id} className="stock-row">
          <span className="skeleton stock-skeleton-photo" />
          <span className="skeleton stock-skeleton-line" />
        </li>
      ))}
    </ul>
  )
}
