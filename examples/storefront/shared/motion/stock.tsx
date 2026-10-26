// Stock that fills in as it arrives, in Motion (React, `motion/react`), for the page's "Coming from
// Motion" panel. Motion has no async values: React's `<Suspense>` waits for the count with `use`, a
// transition keeps the bars on a switch, and each bar says when it's done through its callbacks.
import { motion } from "motion/react"
import { Suspense, use, useState, useTransition } from "react"

type When = "now" | "delivery"
type Counts = Readonly<Record<string, number>>

interface Piece {
  readonly id: string
  readonly name: string
  readonly photo: string
}

/** A shelf holds eight of a piece: a full meter. */
const SHELF = 8

// `use` needs the same promise each render: one per `when`, kept.
const asked = new Map<When, Promise<Counts>>()
const countsFor = (when: When, getStock: (when: When) => Promise<Counts>): Promise<Counts> => {
  const known = asked.get(when)
  if (known) return known
  const promise = getStock(when)
  asked.set(when, promise)
  return promise
}

export function Stock(props: { readonly pieces: ReadonlyArray<Piece>; readonly getStock: (when: When) => Promise<Counts> }) {
  const [when, setWhen] = useState<When>("now")
  const [checking, start] = useTransition()
  const choose = (next: When) => start(() => setWhen(next))
  return (
    <div className="stock">
      <div className="segmented" role="group" aria-label="When">
        <button aria-pressed={when === "now"} onClick={() => choose("now")}>
          Now
        </button>
        <button aria-pressed={when === "delivery"} onClick={() => choose("delivery")}>
          After the delivery
        </button>
      </div>
      <p className="stock-status">{checking ? "Checking the store…" : "The store's count"}</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Rows pieces={props.pieces} counts={countsFor(when, props.getStock)} />
      </Suspense>
    </div>
  )
}

function Rows(props: { readonly pieces: ReadonlyArray<Piece>; readonly counts: Promise<Counts> }) {
  const counts = use(props.counts)
  return (
    <ul className="stock-list">
      {props.pieces.map((piece) => (
        <Row key={piece.id} piece={piece} left={counts[piece.id] ?? 0} />
      ))}
    </ul>
  )
}

function Row(props: { readonly piece: Piece; readonly left: number }) {
  const [filling, setFilling] = useState(true)
  return (
    <li className="stock-row">
      <img src={props.piece.photo} alt="" />
      <span className="name">{props.piece.name}</span>
      <span className="meter">
        <motion.span
          className="meter-fill"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: props.left / SHELF }}
          transition={{ type: "spring", stiffness: 140, damping: 22 }}
          onAnimationStart={() => setFilling(true)}
          onAnimationComplete={() => setFilling(false)}
        />
      </span>
      <span className="stock-label">{filling ? "filling…" : `✓ ${props.left} left`}</span>
    </li>
  )
}
