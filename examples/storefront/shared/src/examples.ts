/**
 * The showcase's examples (#296): each one a feature of the shop, with the words every app shows
 * around its demo. An app routes each to `/<area>/<id>` and supplies the demo; the gallery lists
 * them by area. The smoke runner (`smoke.ts`) opens each route in each app's production build.
 */
import type { AppId } from "./apps.ts"

/** The showcase's areas, in the gallery's order. */
export const AREAS = [
  { id: "entrances", title: "Entrances", blurb: "How the shop arrives: lists and grids that reveal in order." },
  { id: "layout", title: "Layout", blurb: "Elements that move and resize as the page changes around them." },
  { id: "many", title: "Many at once", blurb: "Hundreds of like elements moving as one: a Batch, where each change is one for all of them." },
  { id: "gestures", title: "Gestures", blurb: "Hover, press, drag and swipe, with the momentum of the hand." },
  { id: "presence", title: "Presence", blurb: "Things that leave as nicely as they arrive." },
  { id: "sequences", title: "Sequences", blurb: "Steps that play one after another from code, with the shop's own work between them." },
  { id: "transitions", title: "Page transitions", blurb: "Moving from page to page: the one you leave goes, the next arrives, and what they share flies between them." },
  { id: "live", title: "Live values", blurb: "Values that follow the pointer, the scroll or each other." },
  { id: "server", title: "Server rendering", blurb: "Animations that play before the JavaScript has loaded." },
  { id: "library", title: "With a component library", blurb: "Dialogs, selects and tabs from a component library: its keyboard and accessibility, animated." },
  { id: "shipping", title: "Shipping less", blurb: "Load only the animation code a page uses, and the rest when it's wanted." },
] as const

export type AreaId = (typeof AREAS)[number]["id"]

/** The docs' pages an example links (#908), each with its title in the docs' nav. */
export const DOCS_PAGES = {
  "/guides/animate": "Animate an element",
  "/guides/variants": "Variants",
  "/guides/gestures": "Gestures",
  "/guides/drag": "Drag",
  "/guides/layout": "Layout animations",
  "/guides/presence": "Exit animations",
  "/guides/reorder": "Reorder",
  "/guides/transitions": "Transitions",
  "/guides/scroll": "Scroll",
  "/guides/live-values": "Live values",
  "/guides/server-rendering": "Server rendering",
  "/guides/features": "Shipping less",
  "/guides/batches": "Many elements at once",
  "/guides/actions": "Sequences as actions",
} as const

/** A docs page an example links. */
export type DocsPage = keyof typeof DOCS_PAGES

/** Where the docs are served. */
export const DOCS_ORIGIN = "https://wardic.dev"

/** One example: a shop feature and the pattern it shows. */
export interface Example {
  /** Its route's last segment. */
  readonly id: string
  readonly area: AreaId
  /** The docs' page that explains what it shows (#908): a path on wardic.dev, one of {@link DOCS_PAGES}. */
  readonly docs: DocsPage
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
   * The Foldkit app's words (#795), where the Foldkit form differs: what differs from the Solid apps'
   * (Commands and Messages where Solid has actions and signals), shown above the code on its page alone;
   * and, where this example's `title`, `summary`, `uses`, `why`, `reducedMotion` or `tradeoffs` don't
   * hold on Foldkit, its own (#846: a `why` that explains the pattern in Solid's or Motion's terms gets
   * one in Foldkit's). The note alone may name the Solid form it differs from.
   * Its code is that app's `src/examples/<id>/`.
   */
  readonly foldkit?:
    | {
        readonly note: string
        readonly title?: string | undefined
        readonly summary?: string | undefined
        readonly uses?: ReadonlyArray<string> | undefined
        readonly why?: ReadonlyArray<string> | undefined
        readonly reducedMotion?: string | undefined
        readonly tradeoffs?: { readonly gains: ReadonlyArray<string>; readonly costs: ReadonlyArray<string> } | undefined
      }
    | undefined
  /**
   * What the pattern gains and what it costs, where it's a trade (#526 Q6): two short lists, shown
   * under "Why" in every app.
   */
  readonly tradeoffs?: { readonly gains: ReadonlyArray<string>; readonly costs: ReadonlyArray<string> } | undefined
  /**
   * The apps that have it, where not all three: a pattern only one binding shows (Solid 2's
   * `<Loading>` in a page, #479). Their galleries list it and the smoke test opens it there; the
   * others don't route it.
   */
  readonly apps?: ReadonlyArray<AppId> | undefined
  /**
   * What the smoke test does once the page has loaded, before it watches, for one that waits for the
   * visitor: a selector inside the demo to click, `drag:<selector>:<dx>:<dy>`, or
   * `scroll:<selector>:<dy>` (scrolled by dy over a dozen frames), or several in turn. Absent for one that
   * moves as it loads.
   */
  readonly interact?: string | ReadonlyArray<string> | undefined
  /** What the smoke test watches move, then settle: a selector inside the demo. */
  readonly watch: string
  /**
   * The Solid 2 codes its page makes that are neither Wardic's to fix nor the example's (#460, Q9): a
   * component library's own effects. Each says why, as a test's `allowDiagnostic`; the smoke's dev
   * mode lets them pass here alone, and the page's session still records them.
   */
  readonly allowDiagnostics?: Readonly<Record<string, string>> | undefined
}

export const EXAMPLES: ReadonlyArray<Example> = [
  {
    id: "product-grid",
    foldkit: {
      note: "On Foldkit the card's hover is a Message: `w.OnHoverStart` and `w.OnHoverEnd` tell `update` which card is under the pointer, and the photo's `w.Animate` reads it from the Model.",
      uses: ["Variants", "staggerChildren", "Initial", "Animate", "WhileHover", "OnHoverStart / OnHoverEnd as Messages"],
    },
    area: "entrances",
    docs: "/guides/variants",
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
    id: "stock",
    foldkit: {
      note: "Where the Solid apps read the count as an async memo or under `<Suspense>`, the switch here is a Command that asks the store, the bars kept until it answers.",
      uses: ["Animate from the Model", "a Command over the store", "OnAnimationStart / OnAnimationComplete as Messages", "Transition"],
      why: [
        "A meter that fills to its level says more than a number alone, and one that waits for the real count before it fills never shows a guess. Switch to after the next delivery and each bar grows from where it was, so you see what the delivery brings.",
        "The count comes through a Command that asks the store (`Shop.getStock`); its answer is a Message that sets each piece's level in the Model, and the bars keep their last level until it lands, so a switch to after the delivery grows each from where it is. Each bar's `w.Animate` reads its level from the Model, from `w.Initial({ scaleX: 0 })` the first time.",
        "The label beside each bar reads the bar itself: `w.OnAnimationStart` and `w.OnAnimationComplete` send Messages, so the Model knows a bar is filling (\"filling…\") and when it has landed, with no clock of its own. Try the header's delay to watch the wait.",
      ],
    },
    area: "entrances",
    docs: "/guides/animate",
    title: "Stock that fills in as it arrives",
    summary: "Each piece's stock meter fills in once the store's count arrives, and says when it has settled. Switch to after the delivery and they fill up from where they are.",
    why: [
      "A meter that fills to its level says more than a number alone, and one that waits for the real count before it fills never shows a guess. Switch to after the next delivery and each bar grows from where it was, so you see what the delivery brings.",
      "On Solid 2 the count is an async memo over the store's server function, and each bar's `animate` reads it. Under `<Loading>` the meters wait as a skeleton until the first count lands, then fill from `initial`. A later count keeps the bars where they are until it lands, with no flash of the skeleton, and `isPending` says the store is being checked. The label beside each bar reads the bar's ward: `isPending(() => bar.settled())` holds while its animation runs (\"filling…\"), and the count shows once it has landed.",
      "On Solid 1, `createAsync` reads the count under `<Suspense>`, a switch runs in a transition so the bars stay while the next count loads, and each bar says when it's done through `onAnimationStart` and `onAnimationComplete`, setting a signal. Solid 2 reads both from what it already has: the wait is the memo's, and \"animating\" is `settled()` pending. Try the header's delay to watch the wait.",
    ],
    reducedMotion: "The bars are at their level at once, Wardic's reduced motion snapping their scale, and each label shows its count straight away.",
    uses: ["animate from async data", "<Loading> (Solid\u00a02)", "settled() and isPending (Solid\u00a02)", "onAnimationComplete (Solid\u00a01)"],
    interact: ".stock .segmented button:nth-child(2)",
    watch: ".stock-row:first-child .meter-fill",
  },
  {
    id: "product-detail",
    foldkit: {
      note: "On Foldkit a presence keeps its own children: the fixed frame is one, with `w.Presence({ propagate: true })` of its own, so the detail view inside runs its exit while the frame waits; Escape is a Subscription on the window's keydowns.",
      uses: ["LayoutId", "Layout(\"position\")", "Presence", "Presence({ propagate: true })"],
      why: [
        "A detail view that pops up from nowhere breaks the thread: the eye has to find the product again. When the card itself grows into the view, its photo, name and price travelling to their new places, there's no doubt which piece you opened, and closing it puts it back where it came from.",
        "Each part has a twin: the card in the grid and the detail view share a `w.LayoutId`, and so do their photos, names and prices. When one leaves and the other arrives in the same patch, Wardic animates from one's box to the other's. The names and prices are `w.Layout(\"position\")`, so their text changes size at once and only travels, rather than stretching.",
        "The view sits in a `position: fixed` frame, over a page you may have scrolled. Wardic measures each twin where it's drawn, so the card opens from where you see it, and closes back there, with nothing to mark on the frame.",
      ],
    },
    area: "layout",
    docs: "/guides/layout",
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
    foldkit: {
      note: "On Foldkit the filter and the view live in the Model; the list is a keyed `w.ul` under `w.Presence({ mode: \"popLayout\", initial: false })`.",
      uses: ["Layout", "Layout(\"position\")", "Presence({ mode: \"popLayout\" })"],
      why: [
        "When a filter takes products away and the rest jump to fill the gaps, it's hard to tell what changed. When the ones leaving fade where they were and the rest slide into their new places, the eye can follow each product to where it ends up.",
        "Each product is a `w.Layout()` element, a keyed child of a `w.Presence({ mode: \"popLayout\" })` list. One the filter takes out is popped out of the flow at once, so the products after it start sliding into its space while it fades.",
        "Switching between grid and list changes every card's size, and each card sees its own change and animates from where it was. The photos resize with plain `w.Layout()`, their corners kept round as they scale; the text is `w.Layout(\"position\")`, so it travels without stretching.",
      ],
    },
    area: "layout",
    docs: "/guides/layout",
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
    foldkit: {
      note: "On Foldkit the panel is a keyed child of the `w.Presence({ mode: \"wait\" })` panel element: a new tab is a new child, so the last leaves before it enters.",
      uses: ["LayoutId", "Presence({ mode: \"wait\" })"],
      why: [
        "An underline that blinks from one tab to the next tells you the tab changed. One that slides there also tells you which way you went, and the tabs read as one control rather than three buttons.",
        "There's one indicator, drawn inside whichever tab is selected. Each tab renders it only while it's selected, all with the same `w.LayoutId`, so when the selection changes it leaves one tab and arrives in the next, and Wardic animates it from the old tab's box to the new one's. The panels are keyed children of a `w.Presence({ mode: \"wait\" })` element: a new tab is a new child, and the old one fades out before the new one fades in.",
      ],
    },
    area: "layout",
    docs: "/guides/layout",
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
    foldkit: {
      note: "On Foldkit the add is a Command over the store, its answer a Message that tells the app the cart changed (an OutMessage), and the three-second reset a Command's sleep, interrupted by the next add.",
      uses: ["Layout", "Layout(\"position\")", "Presence", "a Command over the store"],
      why: [
        "A button that works out of sight leaves people pressing it twice. \"Adding…\" while the request is out, then \"Added ✓\" with a link to the cart, answers the question before it's asked. But a label that changes length changes the button's width, and a button that snaps between widths looks broken.",
        "The button is a `w.Layout()` element, so its width animates whenever its label changes it. The label inside is `w.Layout(\"position\")`: it travels to its new place in the button without stretching as the button scales. \"View cart\" enters beside it, a keyed child under `w.Presence()`. The add is a Command over the store, and each state in between is a Message's; set a longer delay, or a failure, in the store's settings (⚙) to see them.",
      ],
    },
    area: "layout",
    docs: "/guides/layout",
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
    foldkit: {
      note: "Solid's `createInstantTransition` has no Foldkit form: Open all and Close all land at once through `w.Config({ skipAnimations })` for the patch that opens them, turned off by a Command 40 ms later.",
      uses: ["Layout", "Layout(\"position\")", "scale correction", "Config({ skipAnimations })"],
      why: [
        "When an answer appears all at once, everything below it jumps, and the reader loses their place. When its card grows and the questions below slide down, the page stays readable while it changes.",
        "Each card is a `w.Layout()` element. Opening one changes its height, and Wardic animates the change as a scale, correcting the card's rounded corners and shadow so they look the same all the way. The question is `w.Layout(\"position\")`, so its text travels rather than stretching, and the answer fades in once there's room for it.",
        "Open all and Close all change every card in one click, which is too much to watch move. They land at once: `w.Config({ skipAnimations: true })` on the list for the patch that opens them, turned off by a Command 40 ms later, so every card takes its new size at once, and the answers and chevrons their end, while a single question still animates.",
      ],
    },
    area: "layout",
    docs: "/guides/layout",
    title: "Questions that open in place",
    summary: "Open an answer, and its card grows to fit while the questions below slide down to make room. Open all, or close all, and they change at once.",
    why: [
      "When an answer appears all at once, everything below it jumps, and the reader loses their place. When its card grows and the questions below slide down, the page stays readable while it changes.",
      "Each card is a `layout` element. Opening one changes its height, and Wardic animates the change as a scale, correcting the card's rounded corners and shadow so they look the same all the way. The question is `layout=\"position\"`, so its text travels rather than stretching, and the answer fades in once there's room for it.",
      "Open all and Close all change every card in one click, which is too much to watch move. They run as an Instant change (`createInstantTransition`, Motion's `useInstantTransition`): every card takes its new size at once, and the answers and chevrons their end, while a single question still animates.",
    ],
    reducedMotion: "The cards change size at once, and the chevron flips at once; the answers still fade.",
    uses: ["layout", "layout=\"position\"", "scale correction", "createInstantTransition"],
    interact: ".faq-item:nth-child(3) .faq-question",
    watch: ".faq-item:nth-child(3)",
  },
  {
    id: "cart-drawer",
    foldkit: {
      note: "On Foldkit the optimistic lines are the Model's own: each change on its way to the store is laid over the server's cart until the store answers, by token.",
      uses: ["Layout", "Presence({ mode: \"popLayout\" })", "optimistic lines in the Model"],
      why: [
        "A cart where nothing moves until the server answers feels broken on a slow connection; one where lines jump into gaps feels careless. When a removed line fades while the rest close up, and a new one slides in at the bottom, the cart reads as one list changing, and it does so the moment you tap.",
        "Each line is a `w.Layout()` element, a keyed child of a `w.Presence({ mode: \"popLayout\" })` list, so one that's removed leaves the flow at once and the lines below slide up while it fades. The suggestions under the list are `w.Layout(\"position\")`, and slide down as lines arrive. The lines on screen are the store's cart with the changes still on their way laid over it, the Model's own, so they animate on the tap, not when the store answers: each change goes to the store as a Command with a token, and the store's answer, or its refusal, takes that change out of the overlay.",
        "The drawer is `position: fixed`, over a page you may have scrolled. Wardic measures every line where it's drawn, so nothing needs marking for that.",
      ],
    },
    area: "layout",
    docs: "/guides/layout",
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
    foldkit: {
      note: "On Foldkit the re-sort returns `Wardic.animateLayout()` as a Command with the Model change, where Solid wraps the change in `useAnimateLayout`.",
      uses: ["Layout", "Layout(\"position\")", "Wardic.animateLayout as a Command", "a scrolling container"],
      why: [
        "A list that re-sorts in a blink leaves you hunting for the order you were looking at. When each one glides to its new place, your eye stays on it. And a panel that scrolls inside a page that scrolls too is where layout animations usually go wrong: measure a row before the panel scrolled and after, and the scroll itself looks like movement.",
        "Each order is a `w.Layout()` element. A re-sort moves the orders without resizing any, and nothing else tells them they've moved, so `update` returns `Wardic.animateLayout()` as a Command beside the Model change: every layout element animates from where it was at the patch. Opening an order changes its height, which it sees itself, so only the rows below it move; its summary is `w.Layout(\"position\")`, so the text travels without stretching.",
        "Wardic takes the scroll of every scrolling element around a layout element out of what it measures, so a row's box is the same however far the panel has scrolled, with nothing to mark on the panel.",
      ],
    },
    area: "layout",
    docs: "/guides/layout",
    title: "Order history in a scrolling panel",
    summary: "Sort your orders and each one glides to its new place; open one and only the orders below it make room.",
    why: [
      "A list that re-sorts in a blink leaves you hunting for the order you were looking at. When each one glides to its new place, your eye stays on it. And a panel that scrolls inside a page that scrolls too is where layout animations usually go wrong: measure a row before the panel scrolled and after, and the scroll itself looks like movement.",
      "Each order is a `layout` element. A re-sort moves the orders without resizing any, and nothing else tells them they've moved, so the sort goes through `animateLayout`: every layout element animates from where it was at the call. Opening an order changes its height, which it sees itself, so only the rows below it move; its summary is `layout=\"position\"`, so the text travels without stretching.",
      "Wardic takes the scroll of every scrolling element around a layout element out of what it measures, so a row's box is the same however far the panel has scrolled, with nothing to mark on the panel.",
    ],
    reducedMotion: "Orders re-sort, open and close at once; their pieces still fade.",
    uses: ["layout", "layout=\"position\"", "useAnimateLayout", "a scrolling container"],
    interact: ".order:nth-child(2) .order-summary",
    watch: ".order:nth-child(2)",
  },
  {
    id: "glaze-library",
    area: "many",
    docs: "/guides/batches",
    title: "A glaze library of 288 swatches",
    summary: "Filter the studio's glazes by family, sort them by colour or shuffle them: every swatch moves to its new place in one change, in a wave.",
    why: [
      "A library of a few hundred glazes is one grid, but each swatch moves on its own: sorted by colour, a swatch at the end crosses the whole grid while its neighbour hardly moves. A Wardic element each would give the page 288 animations to start and step. A Batch keeps their values, speeds and targets together and steps them all in one run.",
      "Wardic's benchmark measured a thousand like elements: changing every target took 0.37 ms as one Batch against 8.2 ms through a call per element, and a frame while they moved 0.75 ms against 1.6. Here the grid is one `createBatch`, keyed by glaze: a new order, a family picked, or a page narrow enough for fewer columns is one change of what `animate` reads, and each swatch turns from where it is, at the speed it has. `stagger()` counts only the swatches a change moves, so the wave runs through the ones that go somewhere.",
      "The swatches are buttons, but the grid is one stop for Tab: the arrow keys move between swatches in the order they're shown, and Enter picks one.",
    ],
    reducedMotion: "Each swatch jumps to its new place, and its size with it; the families you didn't pick still fade.",
    uses: ["createBatch", "keyed by id", "stagger()", "whileHover", "when(\"tap\")", "settled() and isPending"],
    apps: ["solid2"],
    interact: ".glaze-tools .shuffle",
    watch: ".glaze:nth-child(40)",
  },
  {
    id: "archive-search",
    area: "many",
    docs: "/guides/batches",
    title: "Search the studio's archive, 600 pieces",
    summary: "Type to search 600 pieces from forty years of firings: the ones that stop matching leave together, and the rest close up in one change.",
    why: [
      "A search box changes hundreds of results at each keystroke: some leave, the rest move up to fill the gaps. As a Wardic element each, that's hundreds of animations started at every key, each a call of its own. Here the results are one `createBatch`, keyed by piece, under an `<AnimatePresence>`: a keystroke is one change of the list it reads.",
      "A piece that stops matching plays its `exit` before its card goes, and `stagger()` in the exit's transition counts the pieces leaving together, so 590 of them go as one short wave, not a long queue. The pieces that stay move to their new places by their index in the results, with no `layout` to measure. Type a letter and delete it again before the exits land, and the pieces coming back turn around where they are, at the speed they have.",
    ],
    reducedMotion: "The pieces that stop matching fade out, and the rest are in their new places at once.",
    uses: ["createBatch", "keyed by id", "<AnimatePresence>", "exit with stagger()", "settled() and isPending"],
    apps: ["solid2"],
    interact: ".search-suggestions button:nth-child(1)",
    watch: ".archive-card",
  },
  {
    id: "studio-year",
    area: "many",
    docs: "/guides/batches",
    title: "The studio's year, as a chart",
    summary: "Each of the 288 glazes a point: switch the measure and every point moves in one wave; pick a family and the rest shrink away.",
    why: [
      "A chart is many like things that move together: switch from pieces sold to price and every point heads for a new height. The points are SVG circles, one `createBatch` keyed by glaze: a new measure is one change of what `animate` reads, and each point moves from where it is, its `stagger()` a short wave across the chart.",
      "A circle is a member like any element: the Batch moves it by its transform and scales it about its own centre (`transform-box: fill-box`). Under an `<AnimatePresence>`, picking a family shrinks the other points away before their circles go, `stagger()` counting the ones leaving, and brings them back up from the axis. One set of listeners hears every point's hover, `when(\"hoverStart\")` with the glaze it's over.",
      "The chart is drawn for the eye; the same numbers are a table under it, for a screen reader or to read them.",
    ],
    reducedMotion: "The points are at their new heights at once, and the families you didn't pick fade rather than shrink.",
    uses: ["createBatch", "SVG circles as members", "<AnimatePresence>", "stagger()", "when(\"hoverStart\")", "whileHover"],
    apps: ["solid2"],
    interact: ".chart-measures button:nth-child(2)",
    watch: ".chart-point",
  },
  {
    id: "notifications",
    foldkit: {
      note: "On Foldkit the throw is a Message from `w.OnDragEnd`, the landing one from `w.OnAnimationComplete`, and the undo window a Command's sleep: a card put back makes its elapsing moot.",
      uses: ["Drag(\"x\")", "DragSnapToOrigin", "Presence({ mode: \"popLayout\" })", "OnDragEnd / OnAnimationComplete as Messages", "a Command's sleep"],
      why: [
        "A swipe should feel like brushing a card off the table: it follows your finger sideways, and if you let go gently it springs back. Throw it, far enough or fast enough, and it keeps going the way you threw it, at the speed you threw it. Each card is draggable on x only, snapping back to where it was unless the release counts as a throw.",
        "A dismissal you can't take back is unkind, so the request waits. The card flies off, \"Dismissed · Undo\" takes its place for four seconds, and only then is the store told. An undo, or a store that refuses, brings the card back the way it went.",
        "When the store has it, the row leaves the list at once and the rows below glide up into the gap: the list is a `w.Presence({ mode: \"popLayout\" })` element, and each row a `w.Layout()` child. Each card is `w.Drag(\"x\")` with `w.DragSnapToOrigin()`. Its release is a Message from `w.OnDragEnd`, carrying how far and how fast, which `update` judges as a throw or not; its landing is one from `w.OnAnimationComplete`; and the undo window is a Command's sleep that ends in a Message.",
      ],
    },
    area: "gestures",
    docs: "/guides/drag",
    title: "Notifications you swipe away",
    summary: "Throw a notification aside and it flies off; for four seconds you can undo it, then it's gone and the rest close the gap.",
    why: [
      "A swipe should feel like brushing a card off the table: it follows your finger sideways, and if you let go gently it springs back. Throw it, far enough or fast enough, and it keeps going the way you threw it, at the speed you threw it. Each card is draggable on x only, snapping back to where it was unless the release counts as a throw.",
      "A dismissal you can't take back is unkind, so the request waits. The card flies off, \"Dismissed · Undo\" takes its place for four seconds, and only then is the store told. An undo, or a store that refuses, brings the card back the way it went.",
      "When the store has it, the row leaves the list at once and the rows below glide up into the gap: the list is an `AnimatePresence` in `popLayout` mode, and each row a `layout` element. On Solid 2 the card's throw, its landing, the undo window and the request are one `action`, waiting on the card's `next(\"settled\")`. The card's ward is made in its row, beside that action and the releases it reads, and given to the card's `w.article` through `wardRef`. It holds what it hears, the drag; the card's own `variants`, `animate` and `exit` say where it flies.",
    ],
    reducedMotion: "The card still follows your finger; a throw sends it off at once, and the rows below move up at once.",
    uses: ["drag=\"x\"", "dragSnapToOrigin", "AnimatePresence mode=\"popLayout\"", "next(\"settled\") in an action (Solid\u00a02)", "w.ward() given to wardRef (Solid\u00a02)"],
    interact: ['drag:.notice-row[data-id="shipped"] .notice:220:0'],
    watch: '.notice-row[data-id="shipped"] .notice',
  },
  {
    id: "wishlist",
    foldkit: {
      note: "Where Solid 2 follows the feed with `live()` and the group's holds through `list.when(name)`, a Subscription reads the store's feed into Messages, and `w.ReorderGroup` tells each hold and reorder as a Message.", summary: "Drag a piece up or down and the others make way; let go and the new order is saved. The list is shared, and other people's moves glide in live.",
      uses: ["ReorderGroup", "ReorderItem", "the group's holds and reorders as Messages", "a Subscription on the store's feed"],
      why: [
        "Rearranging a list should feel like moving things on a table: the piece follows your hand, the others slide out of its way, and when you let go it settles into the gap. Each piece is a `w.ReorderItem` in a `w.ReorderGroup`. The group changes the order as the piece you hold passes its neighbours, and every other piece animates to its new place.",
        "The order is saved when you let go, once per drag, as \"put it after this one\": the store applies that to its order as it is then, so it means the same whatever else changed meanwhile.",
        "The list is shared by every visitor. The page arrives with the order as it was when the server rendered it, then a Subscription follows the store's feed, a streaming rpc read into Messages, which sends the order again each time anyone moves a piece. Other people's moves glide into place while you watch. While you hold a piece, dragged or lifted with the keys, theirs move around it, but yours stays in your hand, and your drop shows at once while it's saved. The group tells each hold's start and end, and each reorder, as Messages, and the order your hands have made lives in the Model until the feed has your drop.",
      ],
    },
    area: "gestures",
    docs: "/guides/reorder",
    title: "A wishlist you rearrange by hand",
    summary: "Drag a piece up or down and the others make way; let go and the new order is saved. On Solid 2 the list is shared, and other people's moves glide in live.",
    why: [
      "Rearranging a list should feel like moving things on a table: the piece follows your hand, the others slide out of its way, and when you let go it settles into the gap. Each piece is a `Reorder.Item` in a `Reorder.Group`. The group changes the order as the piece you hold passes its neighbours, and every other piece animates to its new place.",
      "The order is saved when you let go, once per drag, as \"put it after this one\": the store applies that to its order as it is then, so it means the same whatever else changed meanwhile.",
      "On Solid 2 the list is shared by every visitor. The page arrives with the order as it was when the server rendered it, then follows a `live()` server function, which sends the order again each time anyone moves a piece. Other people's moves glide into place while you watch. While you hold a piece, dragged or lifted with the keys, theirs move around it, but yours stays in your hand, and your drop shows at once while it's saved. The group tells each hold's start and end, and each reorder, and the page acts on each through an effect over `list.when(name)`: `holdStart`, `reorderEnd` and `holdEnd`. The group is made with `reorderGroup()` beside those reads, and given to `Reorder.Group` through `groupRef`.",
    ],
    reducedMotion: "The piece you hold still follows your hand; the others move to their new places at once, and so does the drop.",
    uses: ["Reorder.Group", "Reorder.Item", "live() and the group's holds (Solid\u00a02)", "a group given to groupRef (Solid\u00a02)"],
    interact: ['drag:.wish[data-id="moon-vase"]:0:130'],
    watch: '.wish[data-id="tulip-bowl"]',
  },
  {
    id: "arrange-room",
    foldkit: {
      note: "On Foldkit the plan is named by its selector, `correctParentTransform(\"#room-plan\")`, since a view has no refs; `w.Config` on the plan gives every piece the mapping.",
      uses: ["transformPagePoint", "correctParentTransform", "Drag", "DragConstraints"],
      why: [
        "A plan you can zoom is drawn with a CSS transform, so the pointer moves in the page's pixels while a piece moves in the plan's: at 140% a piece would run ahead of your pointer, and at 60% lag behind it. Each piece carries a `w.Config` whose `transformPagePoint` is `correctParentTransform(\"#room-plan\")`, the plan named by its selector, which turns each point of a drag back through the plan's zoom, so a piece stays under your pointer at any zoom.",
        "Each piece's `w.DragConstraints(\"parent\")` is the plan itself. Its box is measured through the same mapping, so a piece stops at the room's walls, whatever the zoom.",
      ],
    },
    area: "gestures",
    docs: "/guides/drag",
    title: "Arrange a room, at any zoom",
    summary: "Zoom the floor plan in or out, then drag the sofa, the table and the lamp about: each stays under your pointer, and inside the room.",
    why: [
      "A plan you can zoom is drawn with a CSS transform, so the pointer moves in the page's pixels while a piece moves in the plan's: at 140% a piece would run ahead of your pointer, and at 60% lag behind it. The pieces sit under a `WardicConfig` whose `transformPagePoint` is `correctParentTransform(() => plan)`, which turns each point of a drag back through the plan's zoom, so a piece stays under your pointer at any zoom.",
      "Each piece's `dragConstraints` is the plan itself. Its box is measured through the same mapping, so a piece stops at the room's walls, whatever the zoom.",
    ],
    reducedMotion: "Nothing changes: a piece follows your pointer, and nothing moves by itself.",
    uses: ["transformPagePoint", "correctParentTransform", "drag", "dragConstraints"],
    interact: ['drag:.room-piece[data-id="sofa"]:80:40'],
    watch: '.room-piece[data-id="sofa"]',
  },
  {
    id: "toasts",
    foldkit: {
      note: "On Foldkit each toast's stay is a Command's sleep ending in a Message, and the add a Command over the store that tells the app the cart changed.",
      uses: ["Presence({ mode: \"popLayout\" })", "anchorX / anchorY", "Layout", "Exit"],
      why: [
        "A toast is news that shouldn't stay: it arrives, says its piece and goes. With a few on screen, the stack is a list that changes at both ends, new toasts arriving at the bottom while older ones time out above them. If the gap a toast leaves snaps shut, the one you were reading jumps.",
        "The stack is a `w.Presence({ mode: \"popLayout\" })` element, and each toast a `w.Layout()` child. As a toast leaves, the presence takes it out of the stack's flow at once, held where it was while its exit plays, so the others close the gap as it fades, not after it has gone. The stack sits in its corner, so a leaving toast is pinned by its bottom right (`anchorX: \"right\", anchorY: \"bottom\"`): if the stack resizes while it goes, it stays in the corner. A fourth toast pushes the oldest out the same way.",
        "Each \"Add to cart\" calls the store, so the header's count goes up too. Set the store to fail the next request (⚙ in the header) to see a toast for a failure.",
      ],
    },
    area: "presence",
    docs: "/guides/presence",
    title: "\"Added to cart\", in toasts that make room",
    summary: "Each piece you add says so in a toast; when one goes, the others close the gap.",
    why: [
      "A toast is news that shouldn't stay: it arrives, says its piece and goes. With a few on screen, the stack is a list that changes at both ends, new toasts arriving at the bottom while older ones time out above them. If the gap a toast leaves snaps shut, the one you were reading jumps.",
      "The stack is an `AnimatePresence` in `popLayout` mode, and each toast a `layout` element. As a toast leaves, the presence takes it out of the stack's flow at once, held where it was while its exit plays, so the others close the gap as it fades, not after it has gone. The stack sits in its corner, so a leaving toast is pinned by its bottom right (`anchorX=\"right\" anchorY=\"bottom\"`): if the stack resizes while it goes, it stays in the corner. A fourth toast pushes the oldest out the same way.",
      "Each \"Add to cart\" calls the store, so the header's count goes up too. Set the store to fail the next request (⚙ in the header) to see a toast for a failure.",
    ],
    reducedMotion: "Toasts fade in and out without rising, and the others move to their new places at once.",
    uses: ["AnimatePresence mode=\"popLayout\"", "anchorX / anchorY", "layout", "exit"],
    interact: ".shelf-item:first-child .button",
    watch: ".toast",
  },
  {
    id: "gallery",
    foldkit: {
      note: "On Foldkit the direction and the swipe are Messages, the keyboard an `h.OnKeyDown` on the stage; reduced motion reaches the view from the page's environment, the system's setting or the header's switch.",
      uses: ["Presence({ custom })", "Variants as functions", "Custom", "Exit", "Drag(\"x\")", "DragConstraints", "DragElastic", "reduced motion from the page's environment"],
      why: [
        "A gallery says which way you went by where the photos go: forward, the next one comes in from the right and the last one leaves to the left; back, the other way round. The direction belongs to the change, not to either photo.",
        "Both photos read it from variants that are functions: `enter` and `exit` take the direction and say where to start or end. The new photo resolves `enter` with its own `w.Custom`. The leaving photo can't: it has already left, and gets no new attributes. It resolves `exit` with the presence's `custom`, `w.Presence({ custom })`, read as it leaves, so it's always the latest.",
        "Swipe the photo, or use the arrows, the thumbnails, or the left and right arrow keys once the photo has focus.",
        "A swipe is a drag across, held at the centre (`w.DragConstraints` of 0 each way) but followed all the way (`w.DragElastic(1)`). At the release, `w.OnDragEnd` sends a Message with how far and how fast, and `update` judges whether it was a swipe, distance times speed, as Motion's slideshow judges one. A swipe steps, and its photo goes on out the way it was thrown: the exit's `x` takes over from the drag's spring back. Anything softer springs back to the centre.",
      ],
      reducedMotion: "The photos cross-fade in place. The demo gives the slide no distance under reduced motion (the system's setting or the header's switch, from the page's environment): left to Wardic's rule, which snaps a positional value to its target, a leaving photo would jump aside at once and fade there.",
    },
    area: "presence",
    docs: "/guides/presence",
    title: "A photo gallery that slides the way you go",
    summary: "Swipe or step through the collection's photos: each comes in from the side you're heading to, and the last one leaves by the other.",
    why: [
      "A gallery says which way you went by where the photos go: forward, the next one comes in from the right and the last one leaves to the left; back, the other way round. The direction belongs to the change, not to either photo.",
      "Both photos read it from variants that are functions: `enter` and `exit` take the direction and say where to start or end. The new photo resolves `enter` with its own `custom`. The leaving photo can't: it has already left, and takes no new props. It resolves `exit` with the presence's `custom` instead, read as it leaves, so it's always the latest.",
      "Swipe the photo, or use the arrows, the thumbnails, or the left and right arrow keys once the photo has focus.",
      "A swipe is a drag across, held at the centre (`dragConstraints` of 0 each way) but followed all the way (`dragElastic: 1`). At the release, its distance times its speed says whether it was a swipe, as Motion's slideshow judges one. A swipe steps, and its photo goes on out the way it was thrown: the exit's `x` takes over from the drag's spring back. Anything softer springs back to the centre. On Solid 2 the photo's ward holds the drag, made once and given to each photo in turn, and an effect over `swipe.when(\"dragEnd\")` hears each release; on Solid 1 it's the photo's `onDragEnd`.",
    ],
    reducedMotion: "The photos cross-fade in place. The demo gives the slide no distance under reduced motion (the system's setting through `createReducedMotion`, or the header's switch): left to Wardic's rule, which snaps a positional value to its target, a leaving photo would jump aside at once and fade there.",
    uses: ["AnimatePresence custom", "variants as functions", "custom", "exit", "drag=\"x\"", "dragConstraints", "dragElastic", "createReducedMotion"],
    interact: ".gallery-next",
    watch: ".gallery-photo",
  },
  {
    id: "quick-view",
    foldkit: {
      note: "On Foldkit a presence keeps its own children: the fixed frame is one, with `w.Presence({ propagate: true })` of its own, so the dialog inside runs its exit while the frame waits, and its pairings' presence propagates again.",
      uses: ["Presence({ propagate: true })", "a presence inside a presence", "Exit", "Layout"],
    },
    area: "presence",
    docs: "/guides/presence",
    title: "A quick view whose list leaves before it",
    summary: "Open a piece in a quick view and dismiss the suggestions you don't want. Close it, and what's left of the list goes first.",
    why: [
      "A dialog with a list in it is two things leaving when it closes. If the list vanishes with the dialog, the rows you were reading are gone in a frame, and the dialog fades out around nothing. Better: the rows go first, the dialog after.",
      "The suggestions are a presence of their own, since each can be dismissed by itself with \"Not for me\". Given `propagate`, that presence answers to the one around the dialog: when the dialog leaves, every suggestion still there leaves too, each running its exit, and the dialog stays until they've gone. The dialog's own exit waits a moment, so the list visibly goes first. Without `propagate`, a nested presence's children go with their parent as they are.",
      "Close it with ✕, Escape, or a click outside.",
    ],
    reducedMotion: "The dialog and its suggestions fade in and out; nothing slides or grows.",
    uses: ["AnimatePresence propagate", "a presence inside a presence", "exit", "layout"],
    interact: ".shelf-item:first-child .button",
    watch: ".quick-view",
  },
  {
    id: "saved",
    foldkit: {
      note: "On Foldkit the row's leaving and the twin's arrival are one update: the page tells the app `Arriving` (an OutMessage) and the header renders the twin under its own presence, `w.LayoutCrossfade(false)` on both; a refusal tells `Recalled`.",
      uses: ["LayoutId", "LayoutCrossfade", "arc()", "Presence({ mode: \"popLayout\" })", "Exit", "optimistic rows in the Model"],
      why: [
        "Moving something from one list to another is clearer when you see it go. A piece moved to the cart should travel into the cart, and a piece removed should just fade.",
        "The row's photo and a small photo in the header's cart button share a `w.LayoutId`. On \"Move to cart\", the row leaves and its twin appears in the button in the same update: the page tells the app `Arriving`, and the header renders the twin under its own presence. Wardic measures the two and flies the photo from the row into the button, shrinking it as it goes, tossed in along an arc, `arc()` as the layout transition's `path`, rather than in a straight line. Both photos have `w.LayoutCrossfade(false)`, so one photo flies, into the cart and back out if the store refuses: the one it takes over from is hidden, rather than the two crossfading. Once it lands (`w.OnLayoutAnimationComplete`), the twin shrinks away into the icon with its own `w.Exit`. Removed, the row only fades. The list is in `popLayout` mode, so the rows below close the gap while it goes.",
        "The move doesn't wait for the store: the row leaves the Model at once, before its Command reaches the store. If the store refuses, a `Refused` Message puts the row back where it was, and the page tells the app `Recalled`, so the header lets the twin go and the photo flies back out of the cart. Quick clicks don't trip over each other, and a row already on its way ignores another. Try the header's settings: a delay, or fail the next request.",
      ],
    },
    area: "presence",
    docs: "/guides/transitions",
    title: "Saved for later, moved to the cart",
    summary: "Move a saved piece to your cart and its photo flies into the cart; remove one and it fades. The rest close up behind it.",
    why: [
      "Moving something from one list to another is clearer when you see it go. A piece moved to the cart should travel into the cart, and a piece removed should just fade.",
      "The row's photo and a small photo in the header's cart button share a `layoutId`. On \"Move to cart\", the row leaves and its twin appears in the button in the same update, so Wardic measures the two and flies the photo from the row into the button, shrinking it as it goes. It's tossed in along an arc, `arc()` as the layout transition's `path`, rather than in a straight line. Both photos have `layoutCrossfade={false}`, so one photo flies, into the cart and back out if the store refuses: the one it takes over from is hidden, rather than the two crossfading. Once it lands (`layoutComplete`), the twin shrinks away into the icon with its own `exit`. Removed, the row only fades. The list is in `popLayout` mode, so the rows below close the gap while it goes.",
      "The move doesn't wait for the store. On Solid 2 the list is an optimistic store (`createOptimisticStore`): the action takes the row out at once, before its request, and writes the list for good once the store has the piece. If the store refuses, Solid drops the optimistic write and the row comes back where it was, its photo flying back out of the cart. Quick clicks don't trip over each other, and a row already on its way ignores another. Solid 1 has no optimistic writes, so it does the same by hand: out at once, put back if the request fails. Try the header's settings: a delay, or fail the next request.",
    ],
    reducedMotion: "Nothing flies: a row moved to the cart or removed fades, and the rows below move up at once.",
    uses: ["layoutId", "layoutCrossfade", "arc()", "AnimatePresence mode=\"popLayout\"", "exit", "createOptimisticStore (Solid 2)"],
    interact: ".saved-row:first-child .button.accent",
    watch: ".saved-row:nth-child(2)",
  },
  {
    id: "checkout",
    area: "sequences",
    docs: "/guides/actions",
    title: "Checkout, step by step",
    summary: "Place the order: the cart's lines leave, the store takes the order, then its parcel arrives. Set the store to fail the next request, and the lines come back.",
    why: [
      "Checkout is a sequence with a wait in the middle: what's leaving has to go, the store has to answer, and only then can the parcel arrive. Run it as one Solid 2 `action` and each step is a `yield`: `yield animate(…)` waits for an animation to land, since `createAnimate`'s controls are a promise of their landing, and `yield placeOrder()` waits for the store, so the steps can't overlap or run out of order.",
      "An action is a transition, so Solid holds its writes until it's done: the receipt is written as soon as the store answers, but shows only once the parcel has landed. The button's \"Placing…\" is a `createOptimistic` flag, shown at once and put back as the action ends, whichever way it ends.",
      "A refused order is a thrown error, caught in the action: its last step animates the lines back, and the cart, which the store never emptied, is as it was. Set a failure in the store's settings (⚙) to see it. A placed order empties the cart and joins the visitor's orders: the response names both, so the header's count and Order history follow.",
    ],
    reducedMotion: "The lines and the parcel fade in and out without moving: positions snap, and opacity still animates.",
    uses: ["action()", "createAnimate", "yield animate(…)", "createOptimistic", "a server function between steps", "stagger()"],
    apps: ["solid2"],
    interact: [".checkout .fill", ".checkout .place"],
    watch: ".parcel",
    allowDiagnostics: {
      LONG_HOLD: "The action holds the receipt until the parcel has landed, and that's the point: its animations are the progress, which Solid's measure of the hold can't see.",
    },
  },
  {
    id: "catalogue",
    foldkit: {
      note: "Where the Solid apps route with Solid Router under one layout, the catalogue and each piece are two routes of the app's own parser, under one page the app keeps while the route stays on the example; a card's \"Add\" is a Command over the store.",
      uses: ["Presence({ mode: \"popLayout\" })", "LayoutId", "arc()", "Propagate({ tap: false })", "Exit", "a Piece route under the example", "keyed content"],
      why: [
        "A product page that replaces the list in a cut loses the visitor's place: which photo did they open? If the photo they picked grows into the page's hero, and shrinks back into its card when they return, the two pages read as one place seen closer.",
        "The catalogue and each piece are two routes of the app's own parser, under one page the app keeps while the route stays on the example, and that page puts `w.Presence({ mode: \"popLayout\" })` around them. Each page's root is a keyed `w.*` element with a `w.Exit`. A navigation renders the new root in the old one's place, so the old page leaves by itself. `popLayout` takes the leaving page out of the flow where it was, so the new one is in place at once, and the photo, the same `w.LayoutId` on the card and on the hero, flies between them, bowing a little along an `arc()`.",
        "Each card squeezes a little as it's pressed, and its \"Add\" puts the piece in the cart through a Command over the store, what it shows meanwhile a Message's. The button's press is its own, `w.Propagate({ tap: false })`, so pressing it doesn't squeeze the card, and the same goes for a key. The button sits beside the card's link rather than inside it: `Propagate` keeps the card's press out, and the link's click would still open the piece.",
        "\"Next piece\" stays on the same route with another id, which keeps the page's root: the piece's content is keyed on the id, in a presence of its own, so it slides on while the page stays. A route that stays on the example keeps the page's scroll, as the demo sits partway down a longer page; the app's other navigations scroll to the top. Across a whole app you'd keep that scroll to the top: the photo flies from where the card was seen, and the leaving page stays where it was as it fades (#480).",
      ],
    },
    area: "transitions",
    docs: "/guides/layout",
    title: "From the catalogue to a piece's own page",
    summary: "Open a piece and its photo flies from the catalogue into its own page; go back and it flies home. The two are routes, so the browser's back and forward do the same.",
    why: [
      "A product page that replaces the list in a cut loses the visitor's place: which photo did they open? If the photo they picked grows into the page's hero, and shrinks back into its card when they return, the two pages read as one place seen closer.",
      "The catalogue and each piece are two Solid Router routes under one layout, and the layout puts `<AnimatePresence mode=\"popLayout\">` around its outlet. Each page's root is a Wardic element with an `exit`. A navigation gives the outlet the new page's nodes, so the old page leaves by itself, with no `key`. `popLayout` takes the leaving page out of the flow where it was, so the new one is in place at once, and the photo, the same `layoutId` on the card and on the hero, flies between them, bowing a little along an `arc()`.",
      "Each card squeezes a little as it's pressed, and its \"Add\" puts the piece in the cart. The button's press is its own, `propagate={{ tap: false }}`, so pressing it doesn't squeeze the card, and the same goes for a key. The button sits beside the card's link rather than inside it: `propagate` keeps the card's press out, and the link's click would still open the piece.",
      "\"Next piece\" stays on the same route with another id, which keeps the page's nodes: the piece's content is keyed on the id (`<Show keyed>`, in a presence of its own), so it slides on while the page stays. The links don't scroll (`noScroll`; Solid 2's `noscroll`), as the demo sits partway down a longer page. Across a whole app you'd keep the router's scroll to the top: the photo flies from where the card was seen, and the leaving page stays where it was as it fades (#480).",
    ],
    reducedMotion: "The pages fade from one to the other; the photo doesn't fly and the next piece doesn't slide.",
    uses: ["AnimatePresence mode=\"popLayout\"", "layoutId", "arc()", "propagate={{ tap: false }}", "exit", "Solid Router", "<Show keyed>"],
    interact: ".catalogue-card",
    watch: ".catalogue-hero .photo",
  },
  {
    id: "waiting",
    area: "transitions",
    docs: "/guides/presence",
    title: "Waiting for a piece's details",
    summary: "A piece's page whose details come from the store, on Solid 2: show a skeleton and the photo flies at once, or keep the catalogue until the details land, then fly.",
    why: [
      "A page that loads has two honest ways to wait. It can arrive at once, a skeleton where its details will go, so the visitor sees where they're going; or the page they're on can stay until the next one is ready, so nothing half-built shows. The switch above the demo tries each, and the header's delay makes the wait longer.",
      "The piece's details are an async memo over the store's server function, read on its page. Solid Router navigates inside a transition, so with no `<Loading>` of the page's own the navigation holds: the catalogue stays, not leaving, until the details land, then goes as the page arrives and the photo flies (\"Opening…\" is the router's `useIsRouting`). With a `<Loading>` around the details, that boundary is new, so it shows its skeleton rather than hold: the page is in at once, the catalogue leaving, and the photo flies while the details load.",
      "The photo stays outside that `<Loading>`, so it mounts with the page and its `layoutId` has the card to fly from. Inside it, the photo would mount with the details, after the catalogue has gone, and appear where it is. The details come straight from the server function, not through the router's `query`, whose cache would answer a piece opened again within a few seconds at once.",
    ],
    reducedMotion: "The pages fade from one to the other and the photo doesn't fly; the skeleton and the wait are the same.",
    uses: ["<Loading> in a page", "useIsRouting", "AnimatePresence mode=\"popLayout\"", "layoutId"],
    apps: ["solid2"],
    interact: ".catalogue-card",
    watch: ".catalogue-hero .photo",
  },
  {
    id: "magnifier",
    foldkit: {
      note: "On Foldkit the lens's values are Atoms at module scope, bound in `w.Style`: its `x` and `y`, and the custom properties the stylesheet reads. A Mount on the photo reads the pointer over it as Live values, `Wardic.pointer`, a finger's too, and springs its place, with no Message per move, on the Handle's services through `Wardic.provide`. Reduced motion is an argument of the Mount, and the photo is keyed by it, so a switch mounts it afresh with its springs skipped.",
      uses: ["Wardic.pointer", "LiveValue.spring in a Mount", "Atom.map", "Atoms in w.Style", "WhileHover", "WhileTap", "Wardic.provide"],
      why: [
        "A product photo hides what makes a glazed piece worth buying: where its colours run into each other. A magnifier lets you look closer without leaving the page. A lens glued to the pointer jitters with every twitch of the hand; on a spring, it glides after the pointer and settles where you stop.",
        "The pointer's place over the photo is two Live values the photo's Mount reads from `Wardic.pointer`, a finger's too. `LiveValue.spring` follows each with a spring on the frame loop, idle while it rests, and feeds it into an Atom at module scope that the lens binds in `w.Style` as its `x` and `y`: Live values, which Wardic writes each frame, with no Message per move. `Atom.map` maps the same Atoms to where the photo inside the lens sits, as two custom properties the stylesheet's `background-position` reads, so the lens always shows what's under its centre.",
        "The lens grows in under hover or a press: the photo names a variant, and the lens, a Variant child, follows it.",
        "`Wardic.pointer(element, { types: [\"mouse\", \"pen\", \"touch\"] })`, in the photo's Mount, gives the pointer's place in the photo's pixels and the box's drawn size, set within the pointer's own events, on the Handle's services through `Wardic.provide`.",
      ],
    },
    area: "live",
    docs: "/guides/live-values",
    title: "A closer look at the glaze",
    summary: "Hover over the vase and a lens follows your pointer, gliding after it and settling where you stop.",
    why: [
      "A product photo hides what makes a glazed piece worth buying: where its colours run into each other. A magnifier lets you look closer without leaving the page. A lens glued to the pointer jitters with every twitch of the hand; on a spring, it glides after the pointer and settles where you stop.",
      "The pointer's place over the photo is two plain signals. `createSpring` follows each with a spring on the frame loop, idle while it rests, and the lens takes the springs as its `x` and `y` in `style`: live values, which Wardic writes each frame. `createTransform` maps the same springs to where the photo inside the lens sits, as two custom properties the stylesheet's `background-position` reads, so the lens always shows what's under its centre.",
      "The lens grows in under hover or a press: the photo names a variant, and the lens, a Variant child, follows it.",
      "The photo hears the pointer from Wardic. On Solid 2, its ward only listens (`w.ward()`), given to the photo through `wardRef`; the photo keeps its own variants, `whileHover` and `whileTap`. An effect over `look.when(\"hover\")` hears a mouse, from where it came in and at each move, and effects over `look.when(\"pressStart\")` and `look.when(\"pan\")` hear a finger, which never hovers: each with the photo it's over (`element`, so no `ref`). On Solid 1, the photo's own `onPointerMove` and `onPointerDown` do the same.",
    ],
    reducedMotion: "The lens doesn't glide: it's where the pointer is. A live value is yours, so Wardic's reduced motion leaves it alone; the demo `jump`s its springs to the pointer instead.",
    uses: ["createSpring", "createTransform", "live values in style", "whileHover", "whileTap", "when(\"hover\"), when(\"pan\") (Solid\u00a02)"],
    interact: ".magnifier-photo",
    watch: ".lens",
  },
  {
    id: "before-after",
    area: "live",
    docs: "/guides/live-values",
    title: "Before and after the kiln",
    summary: "Drag the handle across a piece to see it before its glaze and after the kiln; the arrow keys move it too.",
    why: [
      "A compare slider is two photos and a line between them, and the line is wherever the handle is drawn, mid-drag included. The handle's ward reads its own `x` as Wardic draws it, `handle.read(\"x\")`, and `createTransform` turns that into where the photo splits, a custom property in the frame's `style`, so the line follows the handle in the same frame, with no state of the page's own to keep in step.",
      "The labels are the handle's drag as state: `createDrag(handle)` gives the samples of the handle's own drag, so they show while it's held and go as it's let go, with nothing listening to the handle twice. The handle is a `role=\"slider\"`: the arrow keys move it a tenth of the photo, Home and End to either side, through `createAnimate`, and its `x` follows them the same way.",
    ],
    reducedMotion: "The handle follows the pointer as ever, and the arrow keys put it in place at once; the labels still fade.",
    uses: ["drag=\"x\"", "handle.read(\"x\")", "createTransform", "a custom property in style", "createDrag(ward)", "role=\"slider\" and the arrow keys"],
    apps: ["solid2"],
    interact: "drag:.compare-handle:80:0",
    watch: ".compare-handle",
  },
  {
    id: "leaning-bar",
    area: "live",
    docs: "/guides/live-values",
    title: "An announcement bar that leans with your scroll",
    summary: "The studio's news runs across the page; scroll, and the bar leans into it and runs faster, backwards as you scroll up.",
    why: [
      "How fast the page is scrolling is a value like any other: `createVelocity(scrollY)` is the scroll's speed in pixels a second, and a spring over it turns a flick into a lean that eases off rather than stopping dead. `createTransform` maps that speed to the bar's `skewX`, and to how much faster the news runs, so the bar answers the hand without a scroll listener of the page's own.",
      "The news runs on `createAnimationFrame`: each frame it moves by its pace times the frame's own `delta`, quicker as the scroll is, and turns round as the scroll does. Its `x` is a signal in the track's `style`, which the track follows without a render. The lean and the run are on two elements, so the lean settles when the scroll stops while the news runs on.",
    ],
    reducedMotion: "The bar stays still and upright: the news is there to read, and scrolling moves nothing.",
    uses: ["createScroll", "createVelocity", "createSpring", "createTransform", "createAnimationFrame", "a signal in style"],
    apps: ["solid2"],
    interact: "scroll:html:600",
    watch: ".leaning-bar",
  },
  {
    id: "reading-progress",
    foldkit: {
      note: "Where the Solid apps call `createScroll` in the component, the panel's Mount asks `Wardic.scroll({ container })` and feeds an Atom at module scope that the bar binds.",
      uses: ["Wardic.scroll", "Features.scroll", "Atom.map", "scaleX in w.Style", "w.Text"],
      why: [
        "A long read is easier to start when you can see how long it is, and easier to finish when you can see how far you've come. A bar that fills as you scroll says both at a glance, and the minutes left say it in words.",
        "`Wardic.scroll({ container })`, in the panel's Mount, gives the panel's scroll as Live values: how far it's scrolled, and the progress through its range, from 0 to 1, set within the scroll's own event. It feeds an Atom at module scope that the bar binds in `w.Style` as its `scaleX`, drawn from its left edge, so the bar follows the scroll frame by frame. `Atom.map` maps the same progress to the minutes left, bound in `w.Text`. Leave out `container`, and it's the page's scroll. The Handle names `Features.scroll` for it.",
      ],
    },
    area: "live",
    docs: "/guides/scroll",
    title: "A reading bar for the studio's story",
    summary: "Scroll through how the Lagoon glaze is made, and a bar along the top fills as you read, the minutes left beside it.",
    why: [
      "A long read is easier to start when you can see how long it is, and easier to finish when you can see how far you've come. A bar that fills as you scroll says both at a glance, and the minutes left say it in words.",
      "`createScroll` gives the panel's scroll as live values: how far it's scrolled, and the progress through its range, from 0 to 1, set within the scroll's own event. The bar takes the progress as its `scaleX`, drawn from its left edge, and follows the scroll frame by frame. `createTransform` maps the same progress to the minutes left. Leave out `container`, and it's the page's scroll.",
    ],
    reducedMotion: "Nothing changes: the bar is where the scroll is, not an animation of its own.",
    uses: ["createScroll", "createTransform", "scaleX in style"],
    interact: "scroll:.reading-panel:600",
    watch: ".reading-bar",
  },
  {
    id: "parallax",
    foldkit: {
      note: "On Foldkit each banner's Mount asks `Wardic.scroll` for the banner's own progress, with the `target` and `offset`, and feeds two Atoms that its photo's and its words' `w.Style` bind. The banner is keyed by the reduced-motion setting, an argument of its Mount, so a switch mounts it afresh with its drift at 0.",
      uses: ["Wardic.scroll with target and offset", "Atom.map", "y in w.Style"],
      why: [
        "A lookbook is for browsing, and depth makes it feel like a place: as you move, near things pass faster than far ones. Each banner's photo moves a little slower than the banner, and its words a little faster, so the photo reads as behind and the words in front.",
        "Each banner's Mount asks `Wardic.scroll` for the banner's own progress through the panel: with a `target` and Motion's `offset`, `[\"start end\", \"end start\"]`, it's 0 as the banner's top comes in at the bottom and 1 as its bottom leaves at the top. `Atom.map` maps that to a few dozen pixels of `y` for the photo and for the words, one each way, two Atoms their `w.Style` binds.",
        "A parallax is motion of your own, so reduced motion is yours to apply: Wardic snaps the animations it runs, and a Live value follows what moves it. The demo's transforms give 0 under it.",
      ],
    },
    area: "live",
    docs: "/guides/scroll",
    title: "A lookbook with depth",
    summary: "Scroll the lookbook and each collection's photo drifts slower than its banner and its words faster, as if they sat at different depths.",
    why: [
      "A lookbook is for browsing, and depth makes it feel like a place: as you move, near things pass faster than far ones. Each banner's photo moves a little slower than the banner, and its words a little faster, so the photo reads as behind and the words in front.",
      "Each banner asks `createScroll` for its own progress through the panel: with a `target` and Motion's `offset`, `[\"start end\", \"end start\"]`, it's 0 as the banner's top comes in at the bottom and 1 as its bottom leaves at the top. `createTransform` maps that to a few dozen pixels of `y` for the photo and for the words, one each way.",
      "A parallax is motion of your own, so reduced motion is yours to apply: Wardic snaps the animations it runs, and a live value follows what moves it. The demo's transforms give 0 under it.",
    ],
    reducedMotion: "Nothing drifts: the photos and words scroll with their banners.",
    uses: ["createScroll with target and offset", "createTransform", "y in style"],
    interact: "scroll:.lookbook:240",
    watch: ".lookbook-banner:first-child .lookbook-photo",
  },
  {
    id: "reveals",
    foldkit: {
      note: "On Foldkit each chapter takes `w.WhileInView(\"shown\")` and `w.Viewport({ root: \"#story-panel\", once: true, amount: 0.35 })`, the root a selector, since a view has no refs.",
      uses: ["WhileInView", "Viewport: root, amount, once", "Variants", "staggerChildren"],
      why: [
        "Content that arrives as you reach it rewards the scroll: each chapter comes as you get to it rather than all at once at the top, and the eye lands on it as it moves.",
        "Each chapter takes `w.WhileInView(\"shown\")`, a variant it names while it's in view, with `w.Viewport` saying what in view means here: a third of it showing (`amount`) in the story's panel (`root`, named by a selector), and `once`, so scrolling back up doesn't hide it again. Its photo and words are Variant children, staggered by the chapter's transition.",
      ],
    },
    area: "live",
    docs: "/guides/gestures",
    title: "The studio's story, revealed as you read",
    summary: "Each chapter of the studio's story rises into place as it scrolls into view, its photo first and its words after.",
    why: [
      "Content that arrives as you reach it rewards the scroll: each chapter comes as you get to it rather than all at once at the top, and the eye lands on it as it moves.",
      "Each chapter takes `whileInView`, a variant it names while it's in view, with `viewport` saying what in view means here: a third of it showing (`amount`) in the story's panel (`root`), and `once`, so scrolling back up doesn't hide it again. Its photo and words are Variant children, staggered by the chapter's transition.",
    ],
    reducedMotion: "Chapters fade in as they come into view, without rising.",
    uses: ["whileInView", "viewport: root, amount, once", "variants", "staggerChildren"],
    watch: ".chapter:first-child h3",
  },
  {
    id: "spotlight",
    foldkit: {
      note: "On Foldkit each card's Mount reads the pointer over it as Live values, `Wardic.pointer`, a mouse's or a pen's, and two springs follow its place, centred and sent home once it has left (a derived Atom over `inside`); `LiveValue.transform` maps the springs to where the light sits, and the card's `w.Style` binds the tilt and the light's custom properties. The hover's variant is the card's own, `w.WhileHover`. Touch never hovers, so on a phone the cards stay still.",
      uses: ["Wardic.pointer", "LiveValue.spring in a Mount", "LiveValue.transform", "a derived Atom over inside", "custom properties in w.Style and variants", "WhileHover"],
      why: [
        "A card that answers the pointer feels like an object: tilting toward where you point, with a light where your pointer is, it invites a closer look without a single extra control.",
        "The pointer's place over the card is Live values its Mount reads from `Wardic.pointer`, a mouse's or a pen's: its progress across the box, centred to run from -1 to 1 each way, and sent home once it has left, a derived Atom over `inside`. Two `LiveValue.spring`s follow it, so the card eases toward the pointer and back to rest when it leaves. `Atom.map` maps the springs to `rotateX` and `rotateY` in the card's `w.Style`, and `LiveValue.transform` to where its light sits, as custom properties the stylesheet's radial gradient reads. The light comes on through a variant that animates a custom property of its own, `--light`, from 0 to 1 under hover.",
        "The hover is the card's own, `w.WhileHover(\"lit\")`, which lights it; the tilt and the light's place follow the pointer each frame, with no Message per move.",
      ],
    },
    area: "live",
    docs: "/guides/live-values",
    title: "Cards that catch the light",
    summary: "Move over a piece and its card tilts toward your pointer, with a soft light under it that follows.",
    why: [
      "A card that answers the pointer feels like an object: tilting toward where you point, with a light where your pointer is, it invites a closer look without a single extra control.",
      "The pointer's place over the card, from -1 to 1 each way, is two signals that two `createSpring`s follow, so the card eases toward the pointer and back to rest when it leaves. `createTransform` maps the springs twice: to `rotateX` and `rotateY` in the card's `style`, and to where its light sits, as custom properties the stylesheet's radial gradient reads. The light comes on through a variant that animates a custom property of its own, `--light`, from 0 to 1 under hover.",
      "The card hears its hover from Wardic. On Solid 2, its ward is made beside the effects that read it and given to the element through `wardRef`. It only listens (`w.ward()`): the card's own props light it and tilt it. An effect over `card.when(\"hover\")` hears the pointer over the card, from where it came in and at each move, with the card it's over (`element`, so no `ref`), and places the light and the tilt; one over `card.when(\"hoverEnd\")` sends the card back flat. A `hover` at each move is Wardic's own: Motion's hover has only a start and an end. On Solid 1, the element's `onHoverStart` and `onHoverEnd` do the same, with its own `pointermove` for the moves in between. Touch never hovers, so on a phone the cards stay still.",
    ],
    reducedMotion: "The cards don't tilt, and the light is where the pointer is, without the spring. It still comes on and goes off.",
    uses: ["createSpring", "createTransform", "custom properties in style and variants", "whileHover", "when(\"hover\") (Solid\u00a02)"],
    interact: "drag:.spot-grid li:first-child .spot-card:60:40",
    watch: ".spot-grid li:first-child .spot-card",
  },
  {
    id: "announcements",
    foldkit: {
      note: "Where the Solid apps run one frame loop and one cycle for the component's life, each bar here carries its own clock, a Mount that is a Stream; Pause is a Command that sets the switch the clock reads.",
      uses: ["Mount.defineStream", "LiveValue.eachFrame", "w.Presence({ mode: \"wait\" })", "scaleX in w.Style"],
      why: [
        "A strip of news above a shop has more to say than fits, and a visitor reads one line at a time. Taking turns shows each in full, and the bar under it says when the next comes. It holds while the pointer rests on it, and Pause stops it for good, so nobody loses a message halfway through reading it.",
        "The index of the message showing lives in the Model, the messages a constant beside it: `Next` steps to the following one, the first after the last, and each message is a new keyed child of `w.Presence({ mode: \"wait\" })`, so the last fades out before the next fades in. Each message's bar carries its clock, a Mount that is a Stream (`Mount.defineStream`). `LiveValue.eachFrame` runs every frame with the frame's `delta`, which adds up to the message's four seconds and fills the bar, an Atom bound in its `w.Style` as `scaleX`, and sends `Next` when the time is up. The time stands still while the tab is in the background, so a visitor coming back finds the message they left, not the one after; while the pointer rests on the strip; and under Pause, a Command that flips a switch the clock reads each frame.",
      ],
    },
    area: "live",
    docs: "/guides/live-values",
    title: "Announcements that take turns",
    summary: "The strip above the shop shows one message at a time, a bar filling under it, and holds while you read it or look away.",
    why: [
      "A strip of news above a shop has more to say than fits, and a visitor reads one line at a time. Taking turns shows each in full, and the bar under it says when the next comes. It holds while the pointer rests on it, and Pause stops it for good, so nobody loses a message halfway through reading it.",
      "`createCycle` keeps the messages and steps to the next, the first after the last; each is a new child of `<AnimatePresence mode=\"wait\">`, so the last fades out before the next fades in. `createAnimationFrame` runs every frame with the frame's `delta`, which adds up to each message's four seconds and fills the bar, a live value in its `scaleX`. `createPageInView` is `false` while the tab is in the background: then the time stands still, so a visitor coming back finds the message they left, not the one after.",
    ],
    reducedMotion: "The messages fade without sliding; the bar still fills, as time passes, not as an animation of its own.",
    uses: ["createCycle", "createAnimationFrame", "createPageInView", "AnimatePresence mode=\"wait\"", "scaleX in style"],
    watch: ".announcement-message",
  },
  {
    id: "before-hydration",
    foldkit: {
      note: "On Foldkit the status line's Mount is the JavaScript's arrival: a Mount runs on the client alone, once its element is on the page, so the server renders the line without it, from the page's `?hydrate=`. The links carry `?hydrate=` too, which the app's routing answers with a full load (`Navigation.load`) rather than a push, so the server renders the page again.",
      uses: ["Initial", "Animate", "Variants", "staggerChildren", "server-rendered CSS", "a Mount as the take-over"],
      why: [
        "A server-rendered page is on screen before its JavaScript has loaded. An entrance that waits for the JavaScript waits on the network: the banner sits blank, then starts late, or never with the JavaScript off. Wardic writes each element's entrance into the page as a CSS animation, sampled from the same spring or tween the browser would run, so the banner moves from the first paint, from the HTML and its stylesheet alone.",
        "When the JavaScript arrives, Wardic takes each element over from where its CSS has drawn it, by the time that has passed, and carries on with the same spring: no jump, mid-flight or after the end. With no JavaScript, the CSS plays to the end and holds. There's nothing to turn on: every `w.Initial` and `w.Animate` on a server-rendered page gets one, variants and their stagger included.",
        "Try it with the links under the banner. \"Hydrate 2 s late\" holds the JavaScript back, as a slow network would, and \"Don't hydrate\" never runs it, as with the JavaScript off. The line above them says when the JavaScript took over.",
      ],
    },
    area: "server",
    docs: "/guides/server-rendering",
    title: "A banner that arrives before the JavaScript",
    summary: "The season's banner plays its entrance from the first paint, whether the JavaScript is late or never comes.",
    why: [
      "A server-rendered page is on screen before its JavaScript has loaded. An entrance that waits for the JavaScript waits on the network: the banner sits blank, then starts late, or never with the JavaScript off. Wardic writes each element's entrance into the page as a CSS animation, sampled from the same spring or tween the browser would run, so the banner moves from the first paint, from the HTML and its stylesheet alone.",
      "When the JavaScript arrives, Wardic takes each element over from where its CSS has drawn it, by the time that has passed, and carries on with the same spring: no jump, mid-flight or after the end. With no JavaScript, the CSS plays to the end and holds. There's nothing to turn on: every `initial` and `animate` on a server-rendered page gets one, variants and their stagger included.",
      "Try it with the links under the banner. \"Hydrate 2 s late\" holds the JavaScript back, as a slow network would, and \"Don't hydrate\" never runs it, as with the JavaScript off. The line above them says when the JavaScript took over.",
    ],
    reducedMotion: "The photo and lines still fade in one after another, but nothing rises or settles. Before the JavaScript, the page's CSS follows your system's reduced-motion setting; the header's switch counts once the JavaScript has run.",
    uses: ["initial", "animate", "variants", "staggerChildren", "server-rendered CSS"],
    watch: ".season-copy h2",
  },
  {
    id: "wall",
    area: "server",
    docs: "/guides/server-rendering",
    title: "Every piece on one wall, before the JavaScript",
    summary: "The archive's 600 pieces rise onto one wall from the first paint, in a wave, before the page's JavaScript has loaded; it takes over mid-wave.",
    why: [
      "A wall of hundreds of pieces is the first thing on the page, so its entrance should play from the first paint, not once the JavaScript has arrived. The wall is one `createBatch` with `appear: true`: the server writes its entrance into the page's head as one CSS animation for all 600 tiles, each tile's own start and target on its element as custom properties, and its `stagger()` its own delay. As the page hydrates, the Batch takes each tile over where its CSS has got to, at the speed it has there.",
      "A CSS grid places the tiles, so the server needn't know how wide the page is: the Batch moves only what enters, their opacity, scale and rise. Load the page with the JavaScript held back two seconds, and the wave runs on the server's CSS alone, then carries on under the Batch without a jump; turn the JavaScript off, and every tile still rises to its place and stays.",
    ],
    tradeoffs: {
      gains: ["The wall moves from the first paint, the JavaScript or none.", "One CSS animation for 600 tiles, each with its own delay."],
      costs: ["A few KB of CSS in the page's head, and about 85 bytes on each tile before compression.", "Taking 600 animations over reads each once as the page hydrates: at thousands, give it to the ones on screen first."],
    },
    reducedMotion: "The tiles fade in from the first paint, still in a wave, without growing or rising.",
    uses: ["createBatch", "appear: true", "stagger()", "server-rendered CSS", "?hydrate= to hold the JavaScript back"],
    apps: ["solid2"],
    watch: ".wall-tile:nth-child(300)",
  },
  {
    id: "size-guide",
    foldkit: {
      title: "A size guide in Foldkit UI's dialog",
      note: "Where the Solid apps give Kobalte's parts the motion props through `w.create`, Foldkit UI's dialog hands the page each part's attributes, spread onto `w.*` elements of the page's own, and the page closes the library's dialog once Wardic's exits have played.",
      uses: ["Foldkit UI's Dialog", "its attributes on w.* elements", "Presence", "Exit"],
      why: [
        "A dialog's hard part isn't its motion. It's moving focus in and back out, keeping Tab inside, closing on Escape, hiding the page from screen readers, and stopping the page scrolling underneath. A UI library does all of that, and on Foldkit that's `@foldkit/ui`. The guide is its `Dialog`; its motion is Wardic's.",
        "The dialog is a submodel whose `toView` hands the page the attributes of each part, spread onto elements of the page's own: the shade and the guide are `w.*` elements with `w.Initial`, `w.Animate` and `w.Exit`, keyed children under `w.Presence`, so Wardic plays their exits. The library's own presence waits only for CSS animations, so a close request (Escape, the shade, ✕) turns the page's `showing` off first, Wardic runs the exits, and `onExitComplete` then closes the library's dialog, which hands focus back to the button.",
      ],
    },
    area: "library",
    docs: "/guides/presence",
    title: "A size guide in Kobalte's dialog",
    summary: "Open the size guide: the shop dims and the guide rises in. Escape, a click outside or ✕ takes it away as smoothly.",
    why: [
      "A dialog's hard part isn't its motion. It's moving focus in and back out, keeping Tab inside, closing on Escape, hiding the page from screen readers, and stopping the page scrolling underneath. A component library does all of that, and on Solid that's Kobalte. The guide is Kobalte's `Dialog`; its motion is Wardic's.",
      "`w.create(Dialog.Overlay)` and `w.create(Dialog.Content)` give Kobalte's parts the motion props. Wardic puts its ward on the element each part renders, through the ref Kobalte forwards. Kobalte's own presence waits only for CSS animations, so the dialog is `forceMount`ed, and Wardic's `<AnimatePresence>`, around a `<Show>` of the open state, keeps the parts on the page while they leave. Kobalte still hands focus back to the button the moment it closes.",
      "On Solid 2 it's Kobalte 2.0, still an alpha: the console shows its own development warnings.",
    ],
    reducedMotion: "The guide and the shade fade in and out; the guide doesn't rise.",
    uses: ["w.create(Component)", "Kobalte's Dialog, forceMount", "AnimatePresence", "exit"],
    interact: ".size-guide-button",
    watch: ".size-guide",
  },
  {
    id: "sort-by",
    foldkit: {
      title: "Sort the shop with Foldkit UI's listbox",
      note: "Where the Solid apps grow Kobalte's list as a `w.create` element, Foldkit UI's listbox renders and anchors its list itself with a Mount of its own, so the list grows by the stylesheet's transitions on the library's attributes; Wardic's part is the button's press and the pieces' re-sort.",
      uses: ["Foldkit UI's Listbox", "w.attributes", "the library's data-closed and data-placement", "Layout", "Wardic.animateLayout"],
      why: [
        "A select is a list that opens from a button, which the keyboard must reach and walk, with the chosen option announced. `@foldkit/ui`'s `Listbox` does that: it renders its button and its list itself, and anchors the list against the button with a Mount of its own. An element has one Mount on Foldkit, so the list isn't a `w.*` element: it grows and shrinks by the stylesheet's transitions on the library's attributes, `data-closed` as it enters and leaves and `data-placement` for the edge it opens from, so it grows down from the button, or up when there's no room below.",
        "Wardic's part is the button's press, through the Bundle (`w.attributes`), and the pieces, each a `w.Layout()` card. Choosing an order re-sorts them, which moves them without resizing any, so `update` declares it with `Wardic.animateLayout()` as a Command, and they slide to their places as the list closes.",
      ],
    },
    area: "library",
    docs: "/guides/layout",
    title: "Sort the shop with Kobalte's select",
    summary: "Pick an order: the list grows out of its button, and the pieces slide to their new places.",
    why: [
      "A select is a list that opens from a button, which the keyboard must reach and walk, with the chosen option announced. Kobalte's `Select` does that, and places the list against its button. Wardic grows the list from the edge it opens from: Kobalte writes that edge into `--kb-select-content-transform-origin`, and the list's `transform-origin` reads it. So it grows down from the button, or up when there's no room below.",
      "`w.create(Select.Content)` gives Kobalte's list the motion props, and `forceMount` with Wardic's `<AnimatePresence>` lets it shrink back before it goes. Choosing an order re-sorts the pieces, each a `layout` card. A re-sort moves them without resizing any, so it's declared to Wardic with `animateLayout`, and they slide to their places as the list closes.",
      "On Solid 2 it's Kobalte 2.0, still an alpha: the console shows its own development warnings.",
    ],
    reducedMotion: "The list fades in and out without growing, and the pieces move to their places at once.",
    uses: ["w.create(Component)", "Kobalte's Select, forceMount", "transform-origin from the library", "layout", "animateLayout"],
    interact: ".select-trigger",
    watch: ".select-list",
  },
  {
    id: "details-tabs",
    foldkit: {
      title: "A piece's details in Foldkit UI's tabs",
      note: "Where the Solid apps give Kobalte's parts the motion props through `w.create`, Foldkit UI's tabs hand the page each tab's and panel's attributes, spread onto `w.*` elements of the page's own.",
      uses: ["Foldkit UI's Tabs", "LayoutId inside a library's parts", "its attributes on w.* elements"],
      why: [
        "Tabs need more than buttons: arrow keys between them, Home and End, one tab in the Tab order, and `aria-selected` and `aria-controls` kept right. `@foldkit/ui`'s `Tabs` does all of it. How the selection looks is left to you, and here that's Wardic's: one underline with a `w.LayoutId`, drawn inside whichever tab is active, slides from tab to tab however the selection changed.",
        "Tabs on a product page builds the same underline on buttons of its own. Here the tabs are the library's: a submodel whose `toView` hands the page each tab's and panel's attributes, spread onto `w.*` elements of the page's own, and the active panel, keyed by its tab, enters afresh each time with `w.Initial` and `w.Animate`.",
      ],
    },
    area: "library",
    docs: "/guides/layout",
    title: "A piece's details in Kobalte's tabs",
    summary: "Switch between a piece's size, material and care: the underline slides to the tab, whether you click or use the arrow keys.",
    why: [
      "Tabs need more than buttons: arrow keys between them, Home and End, one tab in the Tab order, and `aria-selected` and `aria-controls` kept right. Kobalte's `Tabs` does all of it. How the selection looks is left to you, and here that's Wardic's: one underline with a `layoutId`, drawn inside whichever of Kobalte's triggers is selected, slides from tab to tab however the selection changed.",
      "Tabs on a product page builds the same underline on buttons of its own. Here the panels are Kobalte's too: it swaps them as the tab changes, and each new one fades in, a `w.create(Tabs.Content)`.",
      "On Solid 2 it's Kobalte 2.0, still an alpha: the console shows its own development warnings.",
    ],
    reducedMotion: "The underline moves to its tab at once, and the panels still fade in.",
    uses: ["layoutId inside a library's parts", "Kobalte's Tabs", "w.create(Component)"],
    interact: ".details-tabs .tab:nth-child(2)",
    watch: ".details-tabs .tab-indicator",
    allowDiagnostics: {
      EFFECT_RELAY_TEAR: "Kobalte 2.0's Tabs.List copies the selected trigger into its context from an effect, and Tabs.Content's presence relays its own state (alpha.4)",
      EFFECT_WRITES_OWN_SOURCE: "Tabs.Content's presence (@solid-primitives/presence 1.0.0-next.2) sets `isVisible` from an effect that reads it",
    },
  },
  {
    id: "rearrange",
    foldkit: {
      title: "Rearrange the room: its program loads when you ask",
      summary: "The room's pieces stay put until you press Rearrange. Only then does the page fetch the room's own program, with a Handle of its own, and the card says how long it took to arrive.",
      note: "On Foldkit the room is a Foldkit program of its own (`Runtime.makeElement`), with its own Handle naming `drag` alone, in a module the page imports when you press Rearrange: a Mount on the plan embeds it (`Runtime.embed`) and disposes it when the plan goes. The shop's one Handle has `drag` already, since its other rooms drag on it, so what the press fetches is the room's program, and the card times that; \"Slow connection\" holds the import back.",
      uses: ["Runtime.makeElement", "Runtime.embed from a Mount", "a Handle of its own: Features.drag", "import() on the press", "Drag", "DragConstraints"],
      tradeoffs: {
        gains: [
          "A smaller first load: the room's program and its Handle, under 1 KB gzipped here, are fetched on the press.",
          "The cost only on intent: a visitor who never rearranges never fetches them.",
          "The server's render is unchanged: the room is there, in place, before any script runs.",
        ],
        costs: [
          "Until the program arrives, the pieces aren't handles, and nothing is replayed: a drag begun mid-load is lost.",
          "One more request, made just as the visitor wants to drag.",
          "A second Handle on the page, with Features and services of its own; and `drag`'s code is the shop's already, so the bytes saved are the program's alone.",
        ],
      },
      why: [
        "Most visitors look at a room plan and never move a thing, so the code that lets them is weight they'd pay for nothing. This room is a Foldkit program of its own (`Runtime.makeElement`), with its own Handle naming `Features.drag` alone, in a module the page imports when you press Rearrange: a Mount on the plan loads it (`import()`), embeds it (`Runtime.embed`) and disposes it when the plan goes. Until then the pieces are plain markup.",
        "The cost is the wait. Switch on \"Slow connection\" and the import is held back 1.5 s: drag a piece meanwhile and nothing happens, and once the program arrives, the drag you tried isn't replayed. Replay the demo and it arrives at once: the browser keeps a module it has loaded.",
        "A press is one trigger of several. Load on view, embedding the program as its section scrolls in, for something below the fold that most visitors reach. Load after the first paint, for something nearly everyone uses that needn't hold up the first frame. Load on intent, as here, for something few use. The shop's one Handle has `drag` already, since its other rooms drag on it, so what the press fetches is the room's program, and the card times that.",
      ],
    },
    area: "shipping",
    docs: "/guides/features",
    title: "Rearrange the room: drag loads when you ask",
    summary: "The room's pieces stay put until you press Rearrange. Only then does the page fetch Wardic's drag, and the card says how long it took to arrive.",
    why: [
      "Most visitors look at a room plan and never move a thing, so the code that drags is weight they'd pay for nothing. This page gets `domAnimation` (hover, press, focus and in-view) from the shop's Wardic instance, `createWardic(domAnimation)`, and nothing else. This room's pieces sit in a `LazyWardic` whose `features` is a function, `() => import(\"~/lib/drag-feature.ts\").then((m) => m.drag)`, and a lazy Feature loads as its section renders. The section renders when you press Rearrange, so that's when the page fetches `drag`. Until then the pieces are plain markup.",
      "The cost is the wait. Switch on \"Slow connection\" and the import is held back 1.5 s: drag a piece meanwhile and nothing happens, and once `drag` arrives, the drag you tried isn't replayed. Props whose Feature hasn't arrived do nothing; values still animate at once. Replay the demo and `drag` arrives at once: the browser keeps a module it has loaded, as it would after a page that drags, such as Arrange a room.",
      "A press is one trigger of several. Load on view, rendering the section as it scrolls in, for something below the fold that most visitors reach. Load after the first paint, rendering it once the page has mounted, for something nearly everyone uses that needn't hold up the first frame. Load on intent, as here, for something few use. And a page that uses a Feature from the start brings it with its route: every page in this shop that drags or lays out imports a Wardic instance of its own, `createWardic([domAnimation, drag])`, so the Feature is in the route's own chunk, there when the page is. This room uses a section instead: its load runs again at each press, so the card can time it and hold it back.",
    ],
    tradeoffs: {
      gains: [
        "A smaller first load: the page ships without `drag`'s code, about 7 KB gzipped here, fetched on the press.",
        "The cost only on intent: a visitor who never rearranges never fetches it.",
        "The server's render is unchanged: the room is there, in place, before any script runs.",
      ],
      costs: [
        "Until `drag` arrives, its props do nothing, and nothing is replayed: a drag begun mid-load is lost.",
        "One more request, made just as the visitor wants to drag.",
        "A Feature to remember: each section names the Features it uses, and development warns of one left out.",
      ],
    },
    reducedMotion: "Nothing changes: once `drag` has arrived, a piece follows your pointer, and nothing moves by itself.",
    uses: ["LazyWardic", "features={() => import(…)}", "drag", "dragConstraints"],
    interact: [".rearrange", 'drag:.room-plan[data-drag="arrived"] .room-piece[data-id="sofa"]:80:40'],
    watch: '.room-piece[data-id="sofa"]',
  },
]

/** Whether `app` has `example`: all three do, unless it names its apps. */
export const hasExample = (app: AppId, example: Example): boolean => example.apps === undefined || example.apps.includes(app)

/** The examples of an area that `app` has, in the registry's order. */
export const examplesIn = (area: AreaId, app: AppId): ReadonlyArray<Example> => EXAMPLES.filter((example) => example.area === area && hasExample(app, example))

/** An example by its id. */
export const exampleById = (id: string): Example | undefined => EXAMPLES.find((example) => example.id === id)

/** An example's route. */
export const routeOf = (example: Example): string => `/${example.area}/${example.id}`
