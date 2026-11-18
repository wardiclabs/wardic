/** Text with `backticked` code, as the shared registry writes it. */
import { codeParts } from "@wardic/example-storefront-shared/format"
import * as Bool from "effect/Boolean"
import type { Html, HtmlBuilder } from "foldkit/html"

/** What an element takes as a child: an element, or text. */
type Child = Html | string

export const prose = <Message>(h: HtmlBuilder<Message>, text: string): ReadonlyArray<Child> =>
  codeParts(text).map((part) => Bool.match(part.code, { onTrue: () => h.code([], [part.text]), onFalse: () => part.text }))
