// The Foldkit app's words (#846): what its pages render for an example, the registry's `foldkit`
// words where they're given and the shared ones where not, as `views/words.ts` resolves them, name
// nothing of the Solid apps' or Motion's. The note above the code is left out: its purpose is what
// differs from the Solid apps', so it may name the Solid form.
import { describe, expect, it } from "vitest"
import { EXAMPLES, type Example, hasExample } from "../src/examples.ts"

/** The Solid apps' and Motion's names, which a Foldkit page has no business saying. */
const SOLID = [
  /\bcreate(Signal|Effect|Memo|Animate|Scroll|Transform|Spring|Batch|Cycle|AnimationFrame|PageInView|ReducedMotion|OptimisticStore|Async)\b/,
  /\buse(Animate|AnimateLayout|Scroll)\b/,
  /\bAnimatePresence\b/,
  /<Show\b|<For\b|<Loading>|<Suspense>|<Component>/,
  /\bsignals?\b/,
  /\b[Pp]rops?\b/,
  /\bJSX\b/,
  /\bcreateWardic\b|\bLazyWardic\b|\bWardicConfig\b|\bWardicProvider\b/,
  /`(initial|animate|layout|style)`/,
  /\bcomponents?\b/,
  /\bReorder\.(Group|Item|BatchGroup|BatchItem)\b/,
  /\bwardic\.[a-z]+\b|\bw\.create\b|\bwardRef\b|\bgroupRef\b/,
  /\brefs?\b/,
  /\bonMount\b|\bonDragEnd\b|\bonHoverStart\b|\bonHoverEnd\b|\bonAnimation(Start|Complete)\b|\bonPointer(Move|Down)\b/,
  /\bwhile(Hover|Tap|Drag|Focus|InView)\b/,
  /\blayoutId\b|\blayoutCrossfade\b|\blayoutComplete\b|\blayout="position"/,
  /\bdrag(SnapToOrigin|Constraints|Elastic|Momentum)?=|\bdrag="x"/,
  /\bKobalte\b|\bSolid Router\b|\bnoScroll\b|\bnoscroll\b/,
  /\bisPending\b|\bsettled\(\)|\blive\(\)|\.when\(/,
  /\bSolid [12]\b/,
] as const

/** An example's words as the Foldkit app renders them: `title`, `summary`, `uses`, `why`, `reducedMotion` and `tradeoffs`, the override's where given. */
const foldkitWords = (example: Example): ReadonlyArray<readonly [string, string]> => {
  const tradeoffs = example.foldkit?.tradeoffs ?? example.tradeoffs
  return [
    ["title", example.foldkit?.title ?? example.title],
    ["summary", example.foldkit?.summary ?? example.summary],
    ...(example.foldkit?.uses ?? example.uses).map((use): readonly [string, string] => ["uses", use]),
    ...(example.foldkit?.why ?? example.why).map((paragraph): readonly [string, string] => ["why", paragraph]),
    ["reducedMotion", example.foldkit?.reducedMotion ?? example.reducedMotion],
    ...(tradeoffs?.gains ?? []).map((gain): readonly [string, string] => ["tradeoffs", gain]),
    ...(tradeoffs?.costs ?? []).map((cost): readonly [string, string] => ["tradeoffs", cost]),
  ]
}

describe("the Foldkit app's words (#846)", () => {
  for (const example of EXAMPLES.filter((e) => hasExample("foldkit", e))) {
    it(`${example.id}: says nothing in the Solid apps' terms`, () => {
      const offending = foldkitWords(example).flatMap(([field, text]) => SOLID.filter((term) => term.test(text)).map((term) => `${field}: ${text.match(term)![0]}`))
      expect(offending, `the Foldkit page's words for ${example.id}`).toEqual([])
    })
  }
})
