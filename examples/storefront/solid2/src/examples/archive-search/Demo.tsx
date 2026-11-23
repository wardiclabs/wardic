import { ARCHIVE, search } from "@wardic/example-storefront-shared/archive"
import { colourOf } from "@wardic/example-storefront-shared/glazes"
import { AnimatePresence, createBatch, stagger } from "@wardic/solid"
import { createMemo, createSignal, For, isPending, onSettled, untrack } from "solid-js"

/** A result card's size and the gap after it. */
const CARD = { width: 172, height: 56, gap: 8 }
/** Searches to try, a click each. */
const SUGGESTIONS = ["celadon", "jug", "matte", "1987", "copper vase"]

/** The studio's archive, 600 pieces in one Batch: each search is one change, the pieces that leave go together. */
export default function ArchiveSearch() {
  let scroller!: HTMLDivElement
  const [query, setQuery] = createSignal("")
  const shown = createMemo(() => search(query()))
  // As many columns as the results have room for.
  const [columns, setColumns] = createSignal(4)
  onSettled(() => {
    const observer = new ResizeObserver(() => setColumns(Math.max(1, Math.floor((scroller.clientWidth + CARD.gap) / (CARD.width + CARD.gap)))))
    observer.observe(scroller)
    return () => observer.disconnect()
  })
  const placeAt = (i: number, across: number) => ({ x: (i % across) * (CARD.width + CARD.gap), y: Math.floor(i / across) * (CARD.height + CARD.gap) })

  // Keyed by piece: a piece that stays moves to its new place, at the speed it has; one that comes
  // back before its exit lands turns around where it is.
  const pieces = createBatch({
    each: shown,
    key: "id",
    initial: (_, i) => ({ ...placeAt(i, untrack(columns)), scale: 0.8, opacity: 0 }),
    animate: (_, i) => ({ ...placeAt(i, columns()), scale: 1, opacity: 1 }),
    transition: { type: "spring", visualDuration: 0.4, bounce: 0.15, delay: stagger(0.0008) },
    // stagger() counts the pieces leaving together, so hundreds go as one short wave.
    exit: { scale: 0.8, opacity: 0, transition: { duration: 0.18, delay: stagger(0.0008) } },
  })

  return (
    <div class="archive">
      <input
        class="archive-search"
        type="search"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        placeholder={`Search ${ARCHIVE.length} pieces: celadon, jug, 1987…`}
        aria-label="Search the archive"
      />
      <div class="search-suggestions" role="group" aria-label="Try">
        <For each={SUGGESTIONS}>
          {(suggestion) => (
            <button class="chip" aria-pressed={query() === suggestion ? "true" : "false"} onClick={() => setQuery(suggestion)}>
              {suggestion}
            </button>
          )}
        </For>
        <button class="chip" disabled={query() === ""} onClick={() => setQuery("")}>
          Clear
        </button>
      </div>
      <div class="archive-scroll" ref={scroller}>
        <div class="archive-results" role="list" style={{ height: `${Math.ceil(shown().length / columns()) * (CARD.height + CARD.gap)}px` }}>
          {/* A leaving piece's card stays until its exit lands. */}
          <AnimatePresence>
            <For each={shown()}>
              {(piece) => (
                <div class="archive-card" role="listitem" {...pieces.member(piece.id)}>
                  <span class="archive-chip" style={{ background: colourOf(piece.glaze) }} />
                  <span class="archive-words">
                    <strong>{piece.name}</strong>
                    <span class="muted">
                      {piece.year}, {piece.glaze.finish}
                    </span>
                  </span>
                </div>
              )}
            </For>
          </AnimatePresence>
        </div>
      </div>
      <p class="archive-status muted" aria-live="polite">
        {shown().length} of {ARCHIVE.length}
        {query() === "" ? "" : ` for “${query()}”`} · {isPending(() => pieces.settled()) ? "Moving…" : "Ready"}
      </p>
    </div>
  )
}
