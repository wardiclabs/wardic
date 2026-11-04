import { layout, LazyWardic, w } from "@wardic/solid"
import { createSignal, For, Show } from "solid-js"

const TABS = ["Bowls", "Plates", "Cups"]

/** Tabs with one underline: each tab's has the same `layoutId`, so it flies to the tab that's picked. */
export default function Tabs() {
  const [picked, setPicked] = createSignal("Bowls")
  return (
    <LazyWardic features={[layout]}>
      <div class="sample-tabs" role="tablist" aria-label="Shelves">
        <For each={TABS}>
          {(name) => (
            <button class="sample-tab" role="tab" aria-selected={picked() === name ? "true" : "false"} onClick={() => setPicked(name)}>
              {name}
              <Show when={picked() === name}>
                <w.span class="sample-underline" layoutId="underline" />
              </Show>
            </button>
          )}
        </For>
      </div>
    </LazyWardic>
  )
}
