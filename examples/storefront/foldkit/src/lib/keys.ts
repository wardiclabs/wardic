/**
 * A dialog's Escape (#795): a Subscription entry that hears the window's keydowns while `open` says
 * the dialog is, and sends `message` for Escape. `key` names the entry: the page's, so the pages' entries don't collide.
 */
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as Subscription from "foldkit/subscription"

/** Whether a keydown is Escape's. */
const isEscape = (event: KeyboardEvent): boolean => Str.Equivalence(event.key, "Escape")

export const escapeEntry = <Model, Message>(key: string, open: (model: Model) => boolean, message: Message) =>
  Subscription.make<Model, Message>()((entry) => ({
    [key]: entry(
      { open: Schema.Boolean },
      {
        modelToDependencies: (model) => ({ open: open(model) }),
        dependenciesToStream: ({ open }) => {
          if (!open) return Stream.empty
          return Stream.fromEventListener<KeyboardEvent>(window, "keydown").pipe(
            Stream.filter(isEscape),
            Stream.map(() => message),
          )
        },
      },
    ),
  }))
