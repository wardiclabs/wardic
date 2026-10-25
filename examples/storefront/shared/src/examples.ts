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
  /**
   * What the smoke test clicks once the page has loaded, before it watches: a selector inside the
   * demo, or several in turn, for one that waits for the visitor. Absent for one that moves as it
   * loads.
   */
  readonly interact?: string | ReadonlyArray<string> | undefined
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
    reducedMotion: "The cards fade in, still one after another, but don't rise: movement is dropped, opacity stays. Under the pointer they don't lift and their photos don't grow.",
    uses: ["variants", "staggerChildren", "initial", "animate", "whileHover"],
    watch: ".product-card",
  },
  {
    id: "product-detail",
    area: "layout",
    title: "A product opens into its detail view",
    summary: "Tap a piece and its card grows into the full view, photo, name and price carried across.",
    why: [
      "A detail view that pops up from nowhere breaks the thread: the eye has to find the product again. When the card itself grows into the view, its photo, name and price travelling to their new places, there's no doubt which piece you opened, and closing it puts it back where it came from.",
      "Each part has a twin: the card in the grid and the detail view share a `layoutId`, and so do their photos, names and prices. When one leaves and the other arrives, Wardic animates from one's box to the other's. The names and prices are `layout=\"position\"`, so their text changes size at once and only travels, rather than stretching.",
      "The view sits in a `position: fixed` frame, over a page you may have scrolled. Wardic measures each twin where it's drawn, so the card opens from where you see it, and closes back there, with nothing to mark on the frame.",
    ],
    reducedMotion: "The view opens and closes at once, in place: the boxes don't travel, and the text and backdrop still fade.",
    uses: ["layoutId", "layout=\"position\"", "AnimatePresence"],
    interact: "button.product-card",
    watch: ".detail",
  },
  {
    id: "browse",
    area: "layout",
    title: "Filter the shop, switch the view",
    summary: "Pick a category and the products that stay slide together; switch to a list and every card reshapes into a row.",
    why: [
      "When a filter takes products away and the rest jump to fill the gaps, it's hard to tell what changed. When the ones leaving fade where they were and the rest slide into their new places, the eye can follow each product to where it ends up.",
      "Each product is a `layout` element inside an `<AnimatePresence mode=\"popLayout\">`. One the filter takes out is popped out of the flow at once, so the products after it start sliding into its space while it fades.",
      "Switching between grid and list changes every card's size, and each card sees its own change and animates from where it was. The photos resize with plain `layout`, their corners kept round as they scale; the text is `layout=\"position\"`, so it travels without stretching.",
    ],
    reducedMotion: "Movement and resizing happen at once, not over time: the view switches in place, and products that come or go fade.",
    uses: ["layout", "layout=\"position\"", "AnimatePresence mode=\"popLayout\""],
    interact: ".chips .chip:nth-child(3)",
    watch: ".shop-item",
  },
  {
    id: "product-tabs",
    area: "layout",
    title: "Tabs on a product page",
    summary: "Switch between a piece's description, details and delivery, and the underline slides to the tab you chose.",
    why: [
      "An underline that blinks from one tab to the next tells you the tab changed. One that slides there also tells you which way you went, and the tabs read as one control rather than three buttons.",
      "There's one indicator, drawn inside whichever tab is selected. Each tab renders it only while it's selected, all with the same `layoutId`, so when the selection changes it leaves one tab and arrives in the next, and Wardic animates it from the old tab's box to the new one's. The panels swap in an `<AnimatePresence mode=\"wait\">`: the old one fades out before the new one fades in.",
    ],
    reducedMotion: "The underline moves to its tab at once, and the panels still fade.",
    uses: ["layoutId", "AnimatePresence mode=\"wait\""],
    interact: ".tab:nth-child(2)",
    watch: ".tab-indicator",
  },
  {
    id: "add-to-cart",
    area: "layout",
    title: "Add to cart, and see it's done",
    summary: "The button says what it's doing, adding then added, and makes room for a way to the cart.",
    why: [
      "A button that works out of sight leaves people pressing it twice. \"Adding…\" while the request is out, then \"Added ✓\" with a link to the cart, answers the question before it's asked. But a label that changes length changes the button's width, and a button that snaps between widths looks broken.",
      "The button is a `layout` element, so its width animates whenever its label changes it. The label inside is `layout=\"position\"`: it travels to its new place in the button without stretching as the button scales. \"View cart\" enters beside it through an `<AnimatePresence>`. Set a longer delay, or a failure, in the store's settings (⚙) to see the states in between.",
    ],
    reducedMotion: "The button changes width at once, and \"View cart\" fades in without sliding.",
    uses: ["layout", "layout=\"position\"", "AnimatePresence"],
    interact: ".buy",
    watch: ".buy",
  },
  {
    id: "delivery-faq",
    area: "layout",
    title: "Questions that open in place",
    summary: "Open an answer, and its card grows to fit while the questions below slide down to make room.",
    why: [
      "When an answer appears all at once, everything below it jumps, and the reader loses their place. When its card grows and the questions below slide down, the page stays readable while it changes.",
      "Each card is a `layout` element. Opening one changes its height, and Wardic animates the change as a scale, correcting the card's rounded corners and shadow so they look the same all the way. The question is `layout=\"position\"`, so its text travels rather than stretching, and the answer fades in once there's room for it.",
    ],
    reducedMotion: "The cards change size at once, and the chevron flips at once; the answers still fade.",
    uses: ["layout", "layout=\"position\"", "scale correction"],
    interact: ".faq-item:nth-child(3) .faq-question",
    watch: ".faq-item:nth-child(3)",
  },
  {
    id: "cart-drawer",
    area: "layout",
    title: "A cart drawer that keeps up",
    summary: "Change a quantity or remove a piece, and the lines below close up at once, before the store has answered.",
    why: [
      "A cart where nothing moves until the server answers feels broken on a slow connection; one where lines jump into gaps feels careless. When a removed line fades while the rest close up, and a new one slides in at the bottom, the cart reads as one list changing, and it does so the moment you tap.",
      "Each line is a `layout` element inside an `<AnimatePresence mode=\"popLayout\">`, so one that's removed leaves the flow at once and the lines below slide up while it fades. The suggestions under the list are `layout` too, and slide down as lines arrive. The lines on screen are the store's cart with the changes still on their way laid over it, so they animate on the tap, not when the store answers: on Solid 1 from the router's pending submissions, on Solid 2 from an optimistic store, which drops a change the store refuses by itself.",
      "The drawer is `position: fixed`, over a page you may have scrolled. Wardic measures every line where it's drawn, so nothing needs marking for that.",
    ],
    reducedMotion: "The drawer appears in place and the lines close up at once; the fades stay.",
    uses: ["layout", "AnimatePresence mode=\"popLayout\"", "optimistic updates"],
    interact: [".open-cart", ".suggestion"],
    // The line that suggestion adds: the cart may hold lines from the pages before.
    watch: ".cart-line:last-child",
  },
  {
    id: "order-history",
    area: "layout",
    title: "Order history in a scrolling panel",
    summary: "Sort your orders and each one glides to its new place; open one and only the orders below it make room.",
    why: [
      "A list that re-sorts in a blink leaves you hunting for the order you were looking at. When each one glides to its new place, your eye stays on it. And a panel that scrolls inside a page that scrolls too is where layout animations usually go wrong: measure a row before the panel scrolled and after, and the scroll itself looks like movement.",
      "Each order is a `layout` element. A re-sort moves the orders without resizing any, and nothing else tells them they've moved, so the sort goes through `animateLayout`: every layout element animates from where it was at the call. Opening an order changes its height, which it sees itself, so only the rows below it move; its summary is `layout=\"position\"`, so the text travels without stretching.",
      "Wardic takes the scroll of every scrolling element around a layout element out of what it measures, so a row's box is the same however far the panel has scrolled, with nothing to mark on the panel.",
    ],
    reducedMotion: "Orders re-sort, open and close at once; their pieces still fade.",
    uses: ["layout", "layout=\"position\"", "useAnimateLayout", "a scrolling container"],
    motion: {
      file: "order-history.tsx",
      note: "Motion measures every layout element each time React renders it, so a re-sort needs nothing but the new order. Solid doesn't render a list again to move its rows, so Wardic is told about a change that moves elements without resizing any: wrap it in `animateLayout`.",
    },
    interact: ".order:nth-child(2) .order-summary",
    watch: ".order:nth-child(2)",
  },
  {
    id: "notifications",
    area: "gestures",
    title: "Notifications you swipe away",
    summary: "Throw a notification aside and it flies off; for four seconds you can undo it, then it's gone and the rest close the gap.",
    why: [
      "A swipe should feel like brushing a card off the table: it follows your finger sideways, and if you let go gently it springs back. Throw it, far enough or fast enough, and it keeps going the way you threw it, at the speed you threw it. Each card is draggable on x only, snapping back to where it was unless the release counts as a throw.",
      "A dismissal you can't take back is unkind, so the request waits. The card flies off, \"Dismissed · Undo\" takes its place for four seconds, and only then is the store told. An undo, or a store that refuses, brings the card back the way it went.",
      "When the store has it, the row leaves the list at once and the rows below glide up into the gap: the list is an `AnimatePresence` in `popLayout` mode, and each row a `layout` element. On Solid 2 the card's throw, its landing, the undo window and the request are one `action`, waiting on the card's `next(\"settled\")`. The card's ward is made in its row, beside that action and the releases it reads, and given to the card's `wardic.article` through `wardRef`.",
    ],
    reducedMotion: "The card still follows your finger; a throw sends it off at once, and the rows below move up at once.",
    uses: ["drag=\"x\"", "dragSnapToOrigin", "AnimatePresence mode=\"popLayout\"", "next(\"settled\") in an action (Solid 2)", "a ward given to wardRef (Solid 2)"],
    interact: ['drag:.notice-row[data-id="shipped"] .notice:220:0'],
    watch: '.notice-row[data-id="shipped"] .notice',
  },
  {
    id: "wishlist",
    area: "gestures",
    title: "A wishlist you rearrange by hand",
    summary: "Drag a piece up or down and the others make way; let go and the new order is saved. On Solid 2 the list is shared, and other people's moves glide in live.",
    why: [
      "Rearranging a list should feel like moving things on a table: the piece follows your hand, the others slide out of its way, and when you let go it settles into the gap. Each piece is a `Reorder.Item` in a `Reorder.Group`. The group changes the order as the piece you hold passes its neighbours, and every other piece animates to its new place.",
      "The order is saved when you let go, once per drag, as \"put it after this one\": the store applies that to its order as it is then, so it means the same whatever else changed meanwhile.",
      "On Solid 2 the list is shared by every visitor. The page arrives with the order as it was when the server rendered it, then follows a `live()` server function, which sends the order again each time anyone moves a piece. Other people's moves glide into place while you watch. While you hold a piece, dragged or lifted with the keys, theirs move around it, but yours stays in your hand, and your drop shows at once while it's saved. The group tells each hold's start and end, and each reorder, and the page acts on each through an effect over `list.when(name)`: `holdStart`, `reorderEnd` and `holdEnd`. The group is made with `reorderGroup()` beside those reads, and given to `Reorder.Group` through `groupRef`.",
    ],
    reducedMotion: "The piece you hold still follows your hand; the others move to their new places at once, and so does the drop.",
    uses: ["Reorder.Group", "Reorder.Item", "live() and the group's holds (Solid 2)", "a group given to groupRef (Solid 2)"],
    motion: {
      file: "wishlist.tsx",
      note: "Motion's `Reorder.Group` tells each step of a drag (`onReorder`), not its end, so a Motion list saves from each item's `onDragEnd` and keeps where the drag began itself. Wardic's group also tells `onReorderEnd`: once a gesture, only when the order changed, with the piece and where it went, and for a keyboard reorder too. The Solid 1 app saves with it. The Solid 2 app hears it through `list.when(\"reorderEnd\")`, with the group's `holdStart` and `holdEnd`, which keep the piece in your hand, dragged or lifted, while other people's moves arrive.",
    },
    interact: ['drag:.wish[data-id="moon-vase"]:0:130'],
    watch: '.wish[data-id="tulip-bowl"]',
  },
]

/** The examples of an area, in the registry's order. */
export const examplesIn = (area: AreaId): ReadonlyArray<Example> => EXAMPLES.filter((example) => example.area === area)

/** An example by its id. */
export const exampleById = (id: string): Example | undefined => EXAMPLES.find((example) => example.id === id)

/** An example's route. */
export const routeOf = (example: Example): string => `/${example.area}/${example.id}`
