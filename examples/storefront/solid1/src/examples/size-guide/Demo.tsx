import { Dialog } from "@kobalte/core/dialog"
import { createAsync } from "@solidjs/router"
import { AnimatePresence, w } from "@wardic/solid"
import { createSignal, For, Show, Suspense } from "solid-js"
import { products } from "~/lib/store.ts"

// Kobalte's parts, taking Wardic's motion props: the ward goes on the element each one renders,
// through the ref Kobalte forwards to it.
const Shade = w.create(Dialog.Overlay)
const Guide = w.create(Dialog.Content)

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

export default function SizeGuide() {
  const pieces = createAsync(() => products())
  const [open, setOpen] = createSignal(false)
  return (
    // forceMount: Kobalte keeps its parts mounted, and the presence below decides when they go, so
    // they're still on the page while Wardic plays their exits. Kobalte's own presence waits only
    // for CSS animations. It still moves focus in, keeps Tab inside, and hands focus back on close.
    <Dialog open={open()} onOpenChange={setOpen} forceMount>
      <Dialog.Trigger class="button size-guide-button">Size guide</Dialog.Trigger>
      <Dialog.Portal>
        <AnimatePresence>
          <Show when={open()}>
            <Shade class="backdrop" {...shade} />
            <Guide class="size-guide" {...rise}>
              <header>
                <Dialog.Title>Size guide</Dialog.Title>
                <Dialog.CloseButton class="icon-button" aria-label="Close">
                  ✕
                </Dialog.CloseButton>
              </header>
              <Dialog.Description class="muted">Height × width, or across for plates and bowls.</Dialog.Description>
              <Suspense fallback={<p class="muted">Loading the sizes…</p>}>
                <table class="size-table">
                  <tbody>
                    <For each={pieces()}>
                      {(piece) => (
                        <tr>
                          <th scope="row">{piece.name}</th>
                          <td>{piece.details[0]}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Suspense>
            </Guide>
          </Show>
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog>
  )
}
