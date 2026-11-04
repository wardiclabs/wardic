import { createAsyncStore, useAction } from "@solidjs/router"
import type { Notice } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, drag, LazyWardic, w, type WardicDragInfo } from "@wardic/solid"
import { createSignal, For, onCleanup, Show, Suspense } from "solid-js"
import { dismissNotice, notices, restoreNotices } from "~/lib/store.ts"
import { layout } from "~/lib/layout-feature.ts"

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
  // A store, reconciled by id: a notice read again is the same row, so only the one that went leaves.
  const list = createAsyncStore(() => notices(), { reconcile: { key: "id" } })
  const restore = useAction(restoreNotices)
  const [problem, setProblem] = createSignal<string>()

  return (
    <div class="notices">
      <header class="notices-head">
        <p class="muted">Swipe one aside, either way.</p>
        <button class="button quiet" onClick={() => restore().catch((error: unknown) => setProblem(messageOf(error)))}>
          Bring them back
        </button>
      </header>
      <Suspense fallback={<p class="muted">Loading your notifications…</p>}>
        <Show when={list()}>
          {(shown) => (
            <>
              {/* A row that goes leaves the list at once, and the rows below close the gap. */}
              <ul class="notice-list">
                <AnimatePresence mode="popLayout" initial={false}>
                  <For each={shown()}>{(notice) => <NoticeRow notice={notice} onProblem={setProblem} />}</For>
                </AnimatePresence>
              </ul>
              <Show when={shown().length === 0}>
                <p class="muted notices-empty">You're all caught up.</p>
              </Show>
            </>
          )}
        </Show>
      </Suspense>
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

function NoticeRow(props: { notice: Notice; onProblem: (message: string) => void }) {
  const dismiss = useAction(dismissNotice)
  // Where the card is: set as it's thrown, and put back by an undo or a failure.
  const [side, setSide] = createSignal<Side>()
  const [undoable, setUndoable] = createSignal(false)

  // The request waits for the undo window, which opens once the card has landed off to the side.
  let wait: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(wait))
  const landed = (definition: unknown) => {
    if (definition !== side()) return
    setUndoable(true)
    wait = setTimeout(() => {
      dismiss(props.notice.id).catch(() => {
        putBack()
        props.onProblem("Couldn't dismiss it. It's back.")
      })
    }, UNDO_MS)
  }
  const putBack = () => {
    clearTimeout(wait)
    setUndoable(false)
    setSide(undefined)
  }
  const released = (_event: PointerEvent, info: WardicDragInfo) => {
    const flung = Math.abs(info.offset.x) >= FLING_OFFSET || Math.abs(info.velocity.x) >= FLING_VELOCITY
    if (flung) setSide(sideOf(info.offset.x))
  }

  return (
    <w.li class="notice-row" data-id={props.notice.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <AnimatePresence>
        <Show when={undoable()}>
          <w.p class="notice-undo" {...fade}>
            Dismissed ·{" "}
            <button class="link-button" onClick={putBack}>
              Undo
            </button>
          </w.p>
        </Show>
      </AnimatePresence>
      <w.article
        class="notice"
        classList={{ out: side() !== undefined }}
        data-kind={props.notice.kind}
        drag="x"
        dragSnapToOrigin
        variants={sides}
        initial="shown"
        animate={variantOf(side())}
        onDragEnd={released}
        onAnimationComplete={landed}
      >
        <strong>{props.notice.title}</strong>
        <span class="muted">{props.notice.body}</span>
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
