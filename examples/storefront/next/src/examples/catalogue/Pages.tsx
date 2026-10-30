"use client"
/** The catalogue's two pages (#479): the list, and a piece's own page. */
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { arc, motion } from "motion/react"
import Link from "next/link"

const PIECES = PRODUCTS.slice(0, 6)
const HOME = "/transitions/catalogue"

const pieceOf = (id: string): Product | undefined => PIECES.find((piece) => piece.id === id)
const nextOf = (piece: Product): Product => PIECES[(PIECES.indexOf(piece) + 1) % PIECES.length] as Product

// The photo's flight bows a little (#438): Motion's default layout tween, along an arc.
const FLIGHT = { layout: { type: "tween", duration: 0.45, ease: [0.4, 0, 0.1, 1], path: arc({ strength: 0.25 }) } } as const

function Photo({ piece, sizes }: { readonly piece: Product; readonly sizes: string }) {
  const photo = photoOf(piece.id)
  return (
    // The card's photo and the piece's hero: one `layoutId`, so it flies from one page to the other.
    <motion.div className="photo" layoutId={`catalogue-${piece.id}`} transition={FLIGHT}>
      <img src={photo.small} srcSet={srcsetOf(photo)} sizes={sizes} width={photo.width} height={photo.height} alt={piece.name} />
    </motion.div>
  )
}

/** The catalogue: `/transitions/catalogue`. */
export function CatalogueList() {
  return (
    <ul className="catalogue-list">
      {PIECES.map((piece) => (
        <li key={piece.id}>
          {/* scroll={false}: the demo sits partway down the page, so the router leaves its scroll be. */}
          <Link className="catalogue-card" href={`${HOME}/${piece.id}`} scroll={false}>
            <Photo piece={piece} sizes="160px" />
            <span className="line">
              <span className="name">{piece.name}</span>
              <span className="price">{formatPrice(piece.price)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** A piece's page: `/transitions/catalogue/[id]`. Another piece is another segment, so another page. */
export function CataloguePiece({ id }: { readonly id: string }) {
  const piece = pieceOf(id)
  if (piece === undefined) return <p className="muted">That piece isn&apos;t in the catalogue.</p>
  return (
    <article className="catalogue-piece">
      <nav className="catalogue-nav">
        <Link href={HOME} scroll={false}>
          ← The catalogue
        </Link>
        <Link href={`${HOME}/${nextOf(piece).id}`} scroll={false}>
          Next piece →
        </Link>
      </nav>
      <div className="catalogue-hero">
        <Photo piece={piece} sizes="(max-width: 640px) 100vw, 320px" />
        <div className="catalogue-text">
          <h2>{piece.name}</h2>
          <p className="price">{formatPrice(piece.price)}</p>
          <p>{piece.description}</p>
          <ul className="details">
            {piece.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  )
}
