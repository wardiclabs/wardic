import type { Notice } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, drag, layout, LazyWardic, w } from "@wardic/solid/unstable/v2"
import { revalidate } from "@solidjs/router"
import { action, type Accessor, createEffect, createMemo, createOptimistic, createSignal, For, Loading, refresh, Show, type SourceAccessor } from "solid-js"
import { notices } from "~/lib/store.ts"
import { dismissNotice, restoreNotices } from "~/server/store.ts"

type Side = "left" | "right"

// A card rests in place, or has flown off to a side: from the throw, at its speed, and settled as
// soon as it's out of sight, so "Undo" comes up as it goes. Faded out by 0.2 s and past the edge, it
// can rest coarser than a spring's default (Motion's, 0.5 px and 2 px/s): "Undo" about 500 ms after
// the release, against 650.
const flyOut = { x: { type: "spring", stiffness: 300, damping: 35, restDelta: 1, restSpeed: 20 }, opacity: { type: "tween", duration: 0.2 } } as const
const sides = { shown: { x: 0, opacity: 1 }, left: { x: -420, opacity: 0, transition: flyOut }, right: { x: 420, opacity: 0, transition: flyOut } } as const
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

/** Far enough, or fast enough: a release that throws the card away. */
const FLING_OFFSET = 120
const FLING_VELOCITY = 600
/** How long "Undo" is offered, once the card has flown off. */
const UNDO_MS = 4000

/** The demo, with this page's `drag` and `layout` beside the shell's Features (#526): a page without them ships neither. */
export default function Notifications() {
  return (
    <LazyWardic features={[drag, layout]}>
      <NotificationsDemo />
    </LazyWardic>
  )
}

function NotificationsDemo() {
  const list = createMemo(() => notices())
  const [problem, setProblem] = createSignal<string>()

  const restore = action(function* () {
    setProblem(undefined)
    yield restoreNotices()
    revalidate(notices.key)
  })

  return (
    <div class="notices">
      <header class="notices-head">
        <p class="muted">Swipe one aside, either way.</p>
        <button class="button quiet" onClick={() => restore().catch((error: unknown) => setProblem(messageOf(error)))}>
          Bring them back
        </button>
      </header>
      <Loading fallback={<p class="muted">Loading your notifications…</p>}>
        {/* A row that goes leaves the list at once, and the rows below close the gap. */}
        <ul class="notice-list">
          <AnimatePresence mode="popLayout" initial={false}>
            <For each={list()} keyed={(notice) => notice.id}>
              {(notice) => <NoticeRow notice={notice} list={list} onProblem={setProblem} />}
            </For>
          </AnimatePresence>
        </ul>
        <Show when={list().length === 0}>
          <p class="muted notices-empty">You're all caught up.</p>
        </Show>
      </Loading>
      <Show when={problem()}>
        {(message) => (
          <p class="error-line" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  )
}

function NoticeRow(props: { notice: Accessor<Notice>; list: SourceAccessor<ReadonlyArray<Notice>>; onProblem: (message: string) => void }) {
  // Optimistic: shown at once, and back to nothing when the action ends, whichever way it ends.
  // Where the card is thrown, and "Undo".
  const [out, setOut] = createOptimistic<Side | undefined>(undefined)
  const [undoable, setUndoable] = createOptimistic(false)
  // The side it leaves by, once the store has it: its row then goes, and the card stays off.
  const [gone, setGone] = createSignal<Side>("right")
  // The card's ward, made here with what reads it (`next`, `when`), and given to its element (#349).
  // It holds what it hears, the drag; the card's own props say where it flies (#398).
  const card = w.ward({ drag: "x", dragSnapToOrigin: true })

  // A gesture, its animation and a request, as one sequence: the request goes only once the card
  // has landed off to the side and the undo window has passed. An undo, or a store that refuses,
  // ends the action, and the card flies back.
  let undoNow = () => {}
  const dismiss = action(function* (side: Side) {
    setOut(side)
    yield card.next("settled")
    setUndoable(true)
    const undone: boolean = yield new Promise<boolean>((resolve) => {
      undoNow = () => resolve(true)
      setTimeout(() => resolve(false), UNDO_MS)
    })
    if (undone) return
    yield dismissNotice(props.notice().id)
    setGone(side)
    // The list without it, read in this action: the row goes as the action ends.
    revalidate(notices.key)
    refresh(props.list)
  })

  // Each release, through `when` (#355): an effect that throws the card on a fling, from the first
  // release on, on any page.
  createEffect(card.when("dragEnd"), (release) => {
    const flung = Math.abs(release.offset.x) >= FLING_OFFSET || Math.abs(release.velocity.x) >= FLING_VELOCITY
    if (flung) dismiss(sideOf(release.offset.x)).catch(() => props.onProblem("Couldn't dismiss it. It's back."))
  })

  return (
    <w.li class="notice-row" data-id={props.notice().id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <AnimatePresence>
        <Show when={undoable()}>
          <w.p class="notice-undo" {...fade}>
            Dismissed ·{" "}
            <button class="link-button" onClick={() => undoNow()}>
              Undo
            </button>
          </w.p>
        </Show>
      </AnimatePresence>
      <w.article
        class={["notice", { out: out() !== undefined }]}
        data-kind={props.notice().kind}
        wardRef={card}
        variants={sides}
        initial="shown"
        animate={variantOf(out())}
        exit={gone()}
      >
        <strong>{props.notice().title}</strong>
        <span class="muted">{props.notice().body}</span>
      </w.article>
    </w.li>
  )
}

function variantOf(side: Side | undefined): keyof typeof sides {
  if (side === undefined) return "shown"
  return side
}

function sideOf(offset: number): Side {
  if (offset < 0) return "left"
  return "right"
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
