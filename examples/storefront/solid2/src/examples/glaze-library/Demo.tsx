import { colourOf, FAMILIES, type FamilyId, familyName, type Glaze, GLAZES } from "@wardic/example-storefront-shared/glazes"
import { createBatch, stagger } from "@wardic/solid"
import { createEffect, createMemo, createSignal, For, isPending, onSettled, Show, untrack } from "solid-js"

/** A swatch's size and the gap after it: one step of the grid. */
const STEP = 34
type Order = "family" | "colour" | "name" | "shuffled"

/** Glazes in an order: by family (the library's own), by colour round the wheel, or by name. */
const sortedBy = (order: Exclude<Order, "shuffled">): ReadonlyArray<Glaze> => {
  if (order === "family") return GLAZES
  if (order === "name") return [...GLAZES].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
  return [...GLAZES].sort((a, b) => a.hue - b.hue || b.lightness - a.lightness)
}

const shuffled = (glazes: ReadonlyArray<Glaze>): ReadonlyArray<Glaze> => {
  const out = [...glazes]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** 288 glazes in one Batch: a new order, a family picked or a narrower page moves every swatch in one change. */
export default function GlazeLibrary() {
  let grid!: HTMLDivElement
  const [order, setOrder] = createSignal<Order>("family")
  const [shown, setShown] = createSignal<ReadonlyArray<Glaze>>(GLAZES)
  const [family, setFamily] = createSignal<FamilyId | "all">("all")
  const [picked, setPicked] = createSignal<Glaze>()
  // As many columns as the page has room for: the swatches move to fit as it narrows or widens.
  const [columns, setColumns] = createSignal(16)
  onSettled(() => {
    const observer = new ResizeObserver(() => setColumns(Math.max(6, Math.floor(grid.clientWidth / STEP))))
    observer.observe(grid)
    return () => observer.disconnect()
  })
  const placeAt = (i: number, across: number) => ({ x: (i % across) * STEP, y: Math.floor(i / across) * STEP })
  const matches = (glaze: Glaze) => family() === "all" || glaze.family === family()

  // Keyed by glaze: each change turns every swatch from where it is, at the speed it has.
  const swatches = createBatch({
    each: shown,
    key: "id",
    // Where a swatch starts is read once, as it mounts; where it goes follows the columns.
    initial: (_, i) => ({ ...placeAt(i, untrack(columns)), scale: 0, opacity: 0 }),
    animate: (glaze, i) => ({ ...placeAt(i, columns()), scale: matches(glaze) ? 1 : 0.7, opacity: matches(glaze) ? 1 : 0.22 }),
    // stagger() counts the swatches a change moves, so the wave runs through the ones that go somewhere.
    transition: { type: "spring", visualDuration: 0.5, bounce: 0.2, delay: stagger(0.002) },
    whileHover: { scale: 1.3, transition: { duration: 0.15 } },
    whileTap: { scale: 0.9 },
  })
  createEffect(swatches.when("tap"), ({ item }) => {
    setPicked(item as Glaze)
  })

  const sortBy = (next: Exclude<Order, "shuffled">) => {
    setOrder(next)
    setShown(sortedBy(next))
  }
  const shuffle = () => {
    setOrder("shuffled")
    setShown(shuffled(GLAZES))
  }
  // One stop for Tab: the arrow keys move between swatches in the order they're shown.
  const focused = createMemo(() => shown().indexOf(picked() ?? shown()[0]!))
  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }
    const step = steps[event.key]
    if (step === undefined) return
    event.preventDefault()
    const next = shown()[Math.min(shown().length - 1, Math.max(0, focused() + step))]!
    setPicked(next)
    grid.querySelector<HTMLElement>(`[data-glaze="${next.id}"]`)?.focus()
  }

  return (
    <div class="glaze-library">
      <div class="glaze-tools">
        <div class="chips" role="group" aria-label="Family">
          <For each={[{ id: "all", name: "All" } as const, ...FAMILIES]}>
            {(one) => (
              <button class="chip" aria-pressed={family() === one.id ? "true" : "false"} onClick={() => setFamily(one.id)}>
                {one.name}
              </button>
            )}
          </For>
        </div>
        <div class="segmented" role="group" aria-label="Sort by">
          <For each={[["family", "Family"], ["colour", "Colour"], ["name", "Name"]] as const}>
            {([one, label]) => (
              <button aria-pressed={order() === one ? "true" : "false"} onClick={() => sortBy(one)}>
                {label}
              </button>
            )}
          </For>
          <button class="shuffle" aria-pressed={order() === "shuffled" ? "true" : "false"} onClick={shuffle}>
            Shuffle
          </button>
        </div>
      </div>
      <div class="glaze-grid" ref={grid} style={{ height: `${Math.ceil(GLAZES.length / columns()) * STEP}px` }} onKeyDown={onKeyDown}>
        {/* The swatches render once, in the library's order: a new order changes only what the Batch reads. */}
        <For each={GLAZES}>
          {(glaze) => (
            <button
              class="glaze"
              data-glaze={glaze.id}
              tabindex={shown()[focused()] === glaze ? 0 : -1}
              aria-label={`${glaze.name}, ${glaze.finish}`}
              aria-pressed={picked() === glaze ? "true" : "false"}
              {...swatches.member(glaze.id, { style: { background: colourOf(glaze) } })}
            />
          )}
        </For>
      </div>
      <p class="glaze-status" aria-live="polite">
        <Show when={picked()} fallback={<span class="muted">Pick a glaze to see it up close.</span>}>
          {(glaze) => (
            <>
              <span class="glaze-chip" style={{ background: colourOf(glaze()) }} />
              <strong>{glaze().name}</strong> · {familyName(glaze().family)}, {glaze().finish}
            </>
          )}
        </Show>
        <span class="muted"> · {isPending(() => swatches.settled()) ? "Moving…" : `${GLAZES.length} glazes`}</span>
      </p>
    </div>
  )
}
