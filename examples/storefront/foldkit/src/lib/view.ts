/** What every page renders the same way (#795): a problem a visitor reads, where there is one. */
import type { Html, HtmlBuilder } from "foldkit/html"

/** The error line under a demo, or nothing. */
export const problemLine = <Message>(h: HtmlBuilder<Message>, problem: string | null): ReadonlyArray<Html> => {
  if (problem === null) return []
  return [h.p([h.Class("error-line"), h.Role("alert")], [problem])]
}
