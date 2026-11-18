import { Notice } from "@wardic/example-storefront-shared/server"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { wardic } from "~/lib/wardic.ts"
import { definePage, type PageEnv } from "~/page.ts"
import { Shop } from "~/shop.ts"
import { textOf } from "~/shop/text.ts"

const Side = Schema.Literals(["left", "right"])
type Side = typeof Side.Type

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

const Data = Schema.Struct({ notices: Schema.Array(Notice) })
// Where each thrown card is, and which offer an undo; put back by an undo or a failure.
const Model = Schema.Struct({ notices: Schema.Array(Notice), sides: Schema.Record(Schema.String, Side), undoable: Schema.Array(Schema.String), problem: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({
  Released: { id: Schema.String, offsetX: Schema.Number, velocityX: Schema.Number },
  Landed: { id: Schema.String, at: Schema.String },
  PutBack: { id: Schema.String },
  Elapsed: { id: Schema.String },
  Dismissed: { notices: Schema.Array(Notice) },
  Refused: { id: Schema.String, reason: Schema.String },
  Restore: {},
  Restored: { notices: Schema.Array(Notice) },
  Failed: { reason: Schema.String },
})
type Message = typeof Message.Type

/** The undo window, per card: once it has elapsed, the request goes, unless the card was put back. */
const UndoWindow = Command.define("NoticeUndoWindow", { args: { id: Schema.String }, messages: [Message.Elapsed], execute: ({ id }) => Effect.sleep(UNDO_MS).pipe(Effect.as(Message.Elapsed({ id }))) })
const Dismiss = Command.define("NoticeDismiss", {
  args: { id: Schema.String },
  messages: [Message.Dismissed, Message.Refused],
  execute: ({ id }) =>
    Shop.use((shop) => shop.dismissNotice(id)).pipe(
      Effect.map((notices) => Message.Dismissed({ notices })),
      Effect.catch((error) => Effect.succeed(Message.Refused({ id, reason: textOf(error) }))),
    ),
})
const Restore = Command.define("NoticeRestore", {
  messages: [Message.Restored, Message.Failed],
  execute: Shop.use((shop) => shop.restoreNotices).pipe(
    Effect.map((notices) => Message.Restored({ notices })),
    Effect.catch((error) => Effect.succeed(Message.Failed({ reason: textOf(error) }))),
  ),
})

const sideOf = (offset: number): Side => (offset < 0 ? "left" : "right")

const noticeRow = (model: Model, h: HtmlBuilder<Message>, notice: Notice): Html => {
  const w = wardic.html(h)
  const side = model.sides[notice.id]
  const undoable = model.undoable.includes(notice.id)
  return w.keyed("li")(notice.id, [h.Class("notice-row"), h.DataAttribute("id", notice.id), w.Layout(), w.Initial({ opacity: 0 }), w.Animate({ opacity: 1 }), w.Exit({ opacity: 0 })], [
    w.div([w.Presence()], undoable ? [w.keyed("p")("undo", [h.Class("notice-undo"), w.Initial(fade.initial), w.Animate(fade.animate), w.Exit(fade.exit)], ["Dismissed · ", h.button([h.Class("link-button"), h.OnClick(Message.PutBack({ id: notice.id }))], ["Undo"])])] : []),
    w.article(
      [
        h.Class(side === undefined ? "notice" : "notice out"),
        h.DataAttribute("kind", notice.kind),
        w.Drag("x"),
        w.DragSnapToOrigin(),
        w.Variants(sides),
        w.Initial("shown"),
        w.Animate(side ?? "shown"),
        w.OnDragEnd((_event, info) => Message.Released({ id: notice.id, offsetX: info.offset.x, velocityX: info.velocity.x })),
        // The request waits for the undo window, which opens once the card has landed off to the side.
        w.OnAnimationComplete((definition) => (Predicate.isString(definition) ? Option.some(Message.Landed({ id: notice.id, at: definition })) : Option.none())),
      ],
      [h.strong([], [notice.title]), h.span([h.Class("muted")], [notice.body])],
    ),
  ])
}

const view = defineView<Model, Message, PageEnv>((model, _env, h) => {
  const w = wardic.html(h)
  return h.div([h.Class("notices")], [
    h.header([h.Class("notices-head")], [h.p([h.Class("muted")], ["Swipe one aside, either way."]), h.button([h.Class("button quiet"), h.OnClick(Message.Restore())], ["Bring them back"])]),
    // A row that goes leaves the list at once, and the rows below close the gap.
    w.ul([h.Class("notice-list"), w.Presence({ mode: "popLayout", initial: false })], model.notices.map((notice) => noticeRow(model, h, notice))),
    ...(model.notices.length === 0 ? [h.p([h.Class("muted notices-empty")], ["You're all caught up."])] : []),
    ...(model.problem === null ? [] : [h.p([h.Class("error-line"), h.Role("alert")], [model.problem])]),
  ])
})

/** A card back where it was: no side, no undo. */
const putBack = (model: Model, id: string): Model => {
  const { [id]: _gone, ...sides } = model.sides
  return { ...model, sides, undoable: model.undoable.filter((one) => one !== id) }
}

export default definePage({
  id: "notifications",
  Data,
  Model,
  Message,
  load: Effect.map(Shop.use((shop) => shop.getNotices), (notices) => ({ notices })),
  init: ({ notices }): Model => ({ notices, sides: {}, undoable: [], problem: null }),
  update: (model, message) =>
    Message.match(message, {
      Released: ({ id, offsetX, velocityX }) => {
        const flung = Math.abs(offsetX) >= FLING_OFFSET || Math.abs(velocityX) >= FLING_VELOCITY
        if (!flung) return { model }
        return { model: { ...model, sides: { ...model.sides, [id]: sideOf(offsetX) } } }
      },
      Landed: ({ id, at }) => {
        if (model.sides[id] !== at) return { model }
        return { model: { ...model, undoable: [...model.undoable.filter((one) => one !== id), id] }, commands: [UndoWindow({ id })] }
      },
      PutBack: ({ id }) => ({ model: putBack(model, id) }),
      // Elapsed with the card still off to the side and not put back: dismissed for good.
      Elapsed: ({ id }) => {
        if (!model.undoable.includes(id)) return { model }
        return { model, commands: [Dismiss({ id })] }
      },
      Dismissed: ({ notices }) => ({ model: { ...model, notices } }),
      Refused: ({ id, reason }) => ({ model: { ...putBack(model, id), problem: "Couldn't dismiss it. It's back." + ` (${reason})` } }),
      Restore: () => ({ model: { ...model, problem: null }, commands: [Restore()] }),
      Restored: ({ notices }) => ({ model: { ...model, notices, sides: {}, undoable: [] } }),
      Failed: ({ reason }) => ({ model: { ...model, problem: reason } }),
    }),
  view,
})
