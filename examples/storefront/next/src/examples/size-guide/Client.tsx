"use client"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, m } from "motion/react"
import { Dialog } from "radix-ui"
import { Suspense, use, useState } from "react"

const shade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { type: "tween", duration: 0.2 },
} as const

// The guide rises a little as it fades in, and sinks back, quicker, as it goes.
const rise = {
  initial: { opacity: 0, y: 24, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 12, scale: 0.98, transition: { type: "tween", duration: 0.15 } },
  transition: { type: "spring", stiffness: 380, damping: 32 },
} as const

export function SizeGuide({ pieces }: { readonly pieces: Promise<ReadonlyArray<Product>> }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="button size-guide-button">Size guide</Dialog.Trigger>
      {/* forceMount: Radix keeps its parts mounted, and Motion's presence decides when they go, so
          they're still on the page while their exits play. asChild: each part renders as the
          motion element inside it. */}
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="backdrop" {...shade} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <m.div className="size-guide" {...rise}>
                <header>
                  <Dialog.Title>Size guide</Dialog.Title>
                  <Dialog.Close className="icon-button" aria-label="Close">
                    ✕
                  </Dialog.Close>
                </header>
                <Dialog.Description className="muted">Height × width, or across for plates and bowls.</Dialog.Description>
                <Suspense fallback={<p className="muted">Loading the sizes…</p>}>
                  <Sizes pieces={pieces} />
                </Suspense>
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

function Sizes(props: { readonly pieces: Promise<ReadonlyArray<Product>> }) {
  const pieces = use(props.pieces)
  return (
    <table className="size-table">
      <tbody>
        {pieces.map((piece) => (
          <tr key={piece.id}>
            <th scope="row">{piece.name}</th>
            <td>{piece.details[0]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
