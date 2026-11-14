import { createReducedMotion, WardicConfig } from "@wardic/solid/unstable/v2"
import { w } from "~/lib/wardic.ts"
import { createSignal, For } from "solid-js"

const SETTINGS = ["user", "always", "never"] as const

/** One move under each setting: under reduced motion the box jumps across, and still fades. */
export default function ReducedMotion() {
  const [setting, setSetting] = createSignal<(typeof SETTINGS)[number]>("always")
  const [moved, setMoved] = createSignal(false)
  // The visitor's own setting, as their system gives it.
  const prefers = createReducedMotion()
  return (
    <div class="sample-stack">
      <div class="sample-tabs" role="group" aria-label="reducedMotion">
        <For each={SETTINGS}>
          {(value) => (
            <button class="sample-tab" aria-pressed={setting() === value ? "true" : "false"} onClick={() => setSetting(value)}>
              {value}
            </button>
          )}
        </For>
      </div>
      <button class="sample-button" onClick={() => setMoved(!moved())}>
        Move
      </button>
      <WardicConfig reducedMotion={setting()}>
        <w.div class="sample-box" animate={{ x: moved() ? 160 : 0, opacity: moved() ? 0.4 : 1 }} transition={{ duration: 0.8, ease: "easeInOut" }}>
          box
        </w.div>
      </WardicConfig>
      <p class="sample-note">Your system {prefers() ? "asks" : "doesn't ask"} for reduced motion.</p>
    </div>
  )
}
