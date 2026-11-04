"use client"
import type { Notice } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, m } from "motion/react"
import { startTransition, Suspense, use, useEffect, useRef, useState } from "react"
import { dismissNotice, restoreNotices } from "~/lib/store.ts"

type Side = "left" | "right"

// A card rests in place, or has flown off to a side: from the throw, at its speed, and settled as
// soon as it's out of sight, so "Undo" comes up as it goes. Faded out by 0.2 s and past the edge, it
// can rest coarser than a spring's default (0.5 px and 2 px/s).
const flyOut = { x: { type: "spring", stiffness: 300, damping: 35, restDelta: 1, restSpeed: 20 }, opacity: { type: "tween", duration: 0.2 } } as const
const sides = { shown: { x: 0, opacity: 1 }, left: { x: -420, opacity: 0, transition: flyOut }, right: { x: 420, opacity: 0, transition: flyOut } } as const
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

/** Far enough, or fast enough: a release that throws the card away. */
const FLING_OFFSET = 120
const FLING_VELOCITY = 600
/** How long "Undo" is offered, once the card has flown off. */
const UNDO_MS = 4000

export function Notifications({ notices }: { readonly notices: Promise<ReadonlyArray<Notice>> }) {
  const [problem, setProblem] = useState<string>()
  // A server action: it refreshes the page, which reads the list again.
  const restore = () =>
    startTransition(async () => {
      setProblem(undefined)
      try {
        await restoreNotices()
      } catch (error) {
        setProblem(messageOf(error))
      }
    })

  return (
    <div className="notices">
      <header className="notices-head">
        <p className="muted">Swipe one aside, either way.</p>
        <button className="button quiet" onClick={restore}>
          Bring them back
        </button>
      </header>
      <Suspense fallback={<p className="muted">Loading your notifications…</p>}>
        <List notices={notices} onProblem={setProblem} />
      </Suspense>
      {problem && (
        <p className="error-line" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}

function List({ notices, onProblem }: { readonly notices: Promise<ReadonlyArray<Notice>>; readonly onProblem: (message: string) => void }) {
  const list = use(notices)
  return (
    <>
      {/* A row that goes leaves the list at once, and the rows below close the gap. */}
      <ul className="notice-list">
        <AnimatePresence mode="popLayout" initial={false}>
          {list.map((notice) => (
            <NoticeRow key={notice.id} notice={notice} onProblem={onProblem} />
          ))}
        </AnimatePresence>
      </ul>
      {list.length === 0 && <p className="muted notices-empty">You&apos;re all caught up.</p>}
    </>
  )
}

function NoticeRow({ notice, onProblem }: { readonly notice: Notice; readonly onProblem: (message: string) => void }) {
  // Where the card is thrown: it flies there, and stays there as its row goes.
  const [out, setOut] = useState<Side>()
  const [undoable, setUndoable] = useState(false)
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(pending.current), [])

  // Undone, or refused by the store: "Undo" goes, and the card flies back.
  const back = () => {
    clearTimeout(pending.current)
    setUndoable(false)
    setOut(undefined)
  }
  // Landed off to the side: "Undo" for a while, then the store is told. Its answer refreshes the
  // page, and the row goes, the card staying off.
  const landed = () => {
    setUndoable(true)
    pending.current = setTimeout(
      () =>
        startTransition(async () => {
          try {
            await dismissNotice(notice.id)
          } catch {
            back()
            onProblem("Couldn't dismiss it. It's back.")
          }
        }),
      UNDO_MS,
    )
  }

  return (
    <m.li className="notice-row" data-id={notice.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <AnimatePresence>
        {undoable && (
          <m.p className="notice-undo" {...fade}>
            Dismissed ·{" "}
            <button className="link-button" onClick={back}>
              Undo
            </button>
          </m.p>
        )}
      </AnimatePresence>
      <m.article
        className={out ? "notice out" : "notice"}
        data-kind={notice.kind}
        drag="x"
        dragSnapToOrigin
        variants={sides}
        initial="shown"
        animate={out ?? "shown"}
        exit={out}
        // Each release: a fling throws the card, taking over from its spring back to the centre.
        onDragEnd={(_event, { offset, velocity }) => {
          const flung = Math.abs(offset.x) >= FLING_OFFSET || Math.abs(velocity.x) >= FLING_VELOCITY
          if (flung && out === undefined) setOut(sideOf(offset.x))
        }}
        // Motion tells an animation's end by its target: a side is the throw landing.
        onAnimationComplete={(definition) => {
          if (definition === "left" || definition === "right") landed()
        }}
      >
        <strong>{notice.title}</strong>
        <span className="muted">{notice.body}</span>
      </m.article>
    </m.li>
  )
}

function sideOf(offset: number): Side {
  if (offset < 0) return "left"
  return "right"
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
