import { createAnimate } from "@wardic/solid"
import { action, createOptimistic, createSignal, Show } from "solid-js"

/** A box that opens in two steps, an action yielding each animation: the lid swings aside, then the gem rises. */
export default function Actions() {
  const [scope, animate] = createAnimate()
  const [open, setOpen] = createSignal(false)
  // Shown at once, and put back as the action ends: what the button says while it runs.
  const [busy, setBusy] = createOptimistic(false)
  const toggle = action(function* () {
    setBusy(true)
    const opening = !open()
    // Held with the action: the label below changes once its last animation has landed.
    setOpen(opening)
    if (opening) {
      yield animate(".sample-lid", { x: -56, y: -10, rotate: -24 }, { type: "spring", bounce: 0.4, visualDuration: 0.4 })
      yield animate(".sample-gem", { y: -44, opacity: 1 }, { duration: 0.35 })
      return
    }
    yield animate(".sample-gem", { y: 0, opacity: 0 }, { duration: 0.2 })
    yield animate(".sample-lid", { x: 0, y: 0, rotate: 0 }, { type: "spring", bounce: 0, visualDuration: 0.3 })
  })
  return (
    <div class="sample-stack" ref={scope}>
      <div class="sample-chest">
        <div class="sample-gem" />
        <div class="sample-lid" />
        <div class="sample-chest-base" />
      </div>
      <button class="sample-button" type="button" disabled={busy()} onClick={() => toggle()}>
        <Show when={busy()} fallback={<Show when={open()} fallback="Open the box">Close the box</Show>}>
          Moving…
        </Show>
      </button>
      <p class="sample-note">The box is {open() ? "open" : "closed"}.</p>
    </div>
  )
}
