/**
 * The showcase's examples (#296): each one a feature of the shop, with the words both apps show
 * around its demo. An app routes each to `/<area>/<id>` and supplies the demo; the gallery lists
 * them by area. The smoke runner (`smoke.ts`) opens each route in each app's production build.
 */

/** The showcase's areas, in the gallery's order. */
export const AREAS = [
  { id: "entrances", title: "Entrances", blurb: "How the shop arrives: lists and grids that reveal in order." },
  { id: "layout", title: "Layout", blurb: "Elements that move and resize as the page changes around them." },
  { id: "gestures", title: "Gestures", blurb: "Hover, press, drag and swipe, with the momentum of the hand." },
  { id: "presence", title: "Presence", blurb: "Things that leave as nicely as they arrive." },
  { id: "live", title: "Live values", blurb: "Values that follow the pointer, the scroll or each other." },
  { id: "server", title: "Server rendering", blurb: "Animations that play before the JavaScript has loaded." },
] as const

export type AreaId = (typeof AREAS)[number]["id"]

/** One example: a shop feature and the pattern it shows. */
export interface Example {
  /** Its route's last segment. */
  readonly id: string
  readonly area: AreaId
  readonly title: string
  /** One line for the gallery's card. */
  readonly summary: string
  /** Why it's worth reaching for: a paragraph or two. */
  readonly why: ReadonlyArray<string>
  /** What reduced motion does to it (ADR-0029), shown under the demo. */
  readonly reducedMotion: string
  /** The props and helpers it shows, for the gallery's card. */
  readonly uses: ReadonlyArray<string>
  /**
   * Where porting from Motion isn't mechanical (#296 Q4): the Motion snippet's file in
   * `motion/`, and a line on what changes. Absent when only `motion.` becomes `wardic.`.
   */
  readonly motion?: { readonly file: string; readonly note: string } | undefined
  /** What the smoke test watches move, then settle: a selector inside the demo. */
  readonly watch: string
}

export const EXAMPLES: ReadonlyArray<Example> = [
  {
    id: "product-grid",
    area: "entrances",
    title: "The product grid",
    summary: "The shop's grid fades and rises in, one card after another.",
    why: [
      "A grid that appears all at once is a wall of pictures. Revealing the cards one after another gives the eye a path through them, from the first product to the last, and the page feels like it's arriving rather than loading.",
      "The grid names a variant, and every card under it follows: the grid's `staggerChildren` delays each card by its place, so the order is the layout's order, whatever the products are. Change the products, and the reveal follows. No card knows its own delay.",
    ],
    reducedMotion: "The cards fade in, still one after another, but don't rise: movement is dropped, opacity stays.",
    uses: ["variants", "staggerChildren", "initial", "animate"],
    watch: ".product-card",
  },
]

/** The examples of an area, in the registry's order. */
export const examplesIn = (area: AreaId): ReadonlyArray<Example> => EXAMPLES.filter((example) => example.area === area)

/** An example by its id. */
export const exampleById = (id: string): Example | undefined => EXAMPLES.find((example) => example.id === id)

/** An example's route. */
export const routeOf = (example: Example): string => `/${example.area}/${example.id}`
