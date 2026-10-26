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
   * What the smoke test does once the page has loaded, before it watches, for one that waits for the
   * visitor: a selector inside the demo to click, `drag:<selector>:<dx>:<dy>`, or
   * `scroll:<selector>:<dy>` (scrolled by dy over a dozen frames), or several in turn. Absent for one that
   * moves as it loads.
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
      "When the store has it, the row leaves the list at once and the rows below glide up into the gap: the list is an `AnimatePresence` in `popLayout` mode, and each row a `layout` element. On Solid 2 the card's throw, its landing, the undo window and the request are one `action`, waiting on the card's `next(\"settled\")`. The card's ward is made in its row, beside that action and the releases it reads, and given to the card's `wardic.article` through `wardRef`. It holds what it hears, the drag; the card's own `variants`, `animate` and `exit` say where it flies.",
    ],
    reducedMotion: "The card still follows your finger; a throw sends it off at once, and the rows below move up at once.",
    uses: ["drag=\"x\"", "dragSnapToOrigin", "AnimatePresence mode=\"popLayout\"", "next(\"settled\") in an action (Solid 2)", "a ward given to wardRef, the motion on its element (Solid 2)"],
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
  {
    id: "toasts",
    area: "presence",
    title: "\"Added to cart\", in toasts that make room",
    summary: "Each piece you add says so in a toast; when one goes, the others close the gap.",
    why: [
      "A toast is news that shouldn't stay: it arrives, says its piece and goes. With a few on screen, the stack is a list that changes at both ends, new toasts arriving at the bottom while older ones time out above them. If the gap a toast leaves snaps shut, the one you were reading jumps.",
      "The stack is an `AnimatePresence` in `popLayout` mode, and each toast a `layout` element. As a toast leaves, the presence takes it out of the stack's flow at once, held where it was while its exit plays, so the others close the gap as it fades, not after it has gone. A fourth toast pushes the oldest out the same way.",
      "Each \"Add to cart\" calls the store, so the header's count goes up too. Set the store to fail the next request (⚙ in the header) to see a toast for a failure.",
    ],
    reducedMotion: "Toasts fade in and out without rising, and the others move to their new places at once.",
    uses: ["AnimatePresence mode=\"popLayout\"", "layout", "exit"],
    interact: ".shelf-item:first-child .button",
    watch: ".toast",
  },
  {
    id: "gallery",
    area: "presence",
    title: "A photo gallery that slides the way you go",
    summary: "Step through the collection's photos: each comes in from the side you're heading to, and the last one leaves by the other.",
    why: [
      "A gallery says which way you went by where the photos go: forward, the next one comes in from the right and the last one leaves to the left; back, the other way round. The direction belongs to the change, not to either photo.",
      "Both photos read it from variants that are functions: `enter` and `exit` take the direction and say where to start or end. The new photo resolves `enter` with its own `custom`. The leaving photo can't: it has already left, and takes no new props. It resolves `exit` with the presence's `custom` instead, read as it leaves, so it's always the latest.",
      "Use the arrows, the thumbnails, or the left and right arrow keys once the photo has focus.",
    ],
    reducedMotion: "The photos cross-fade in place. The demo gives the slide no distance under reduced motion (the system's setting through `createReducedMotion`, or the header's switch): left to Wardic's rule, which snaps a positional value to its target, a leaving photo would jump aside at once and fade there.",
    uses: ["AnimatePresence custom", "variants as functions", "custom", "exit", "createReducedMotion"],
    motion: {
      file: "gallery.tsx",
      note: "Motion changes the photo by giving it a new `key`: React unmounts the old element, which `AnimatePresence` keeps for its exit, and mounts a new one. Solid has no keys on elements: `<Show when={…} keyed>` makes a new photo each time the piece shown changes, and the presence takes the old one out the same way.",
    },
    interact: ".gallery-next",
    watch: ".gallery-photo",
  },
  {
    id: "quick-view",
    area: "presence",
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
    area: "presence",
    title: "Saved for later, moved to the cart",
    summary: "Move a saved piece to your cart and its photo flies there; remove one and it fades. The rest close up behind it.",
    why: [
      "Moving something from one list to another is clearer when you see it go. A piece moved to the cart should travel to the cart, and a piece removed should just fade. That flight isn't something an `exit` can name: it depends on where the cart button is at the moment the row leaves.",
      "So the row writes its own exit. `usePresence` tells the row when it has left, with the presence's `custom` (here, why it's leaving), and keeps it on the page until it calls `safeToRemove`. Moved to the cart, a copy of its photo flies in an arc to the header's cart while the row fades: a Web Animation. Removed, it only fades. The list is in `popLayout` mode, so the rows below close the gap while it goes.",
      "On Solid 1, `usePresence` takes the row and a callback; on Solid 2 it's a handle given to `ref`, whose `next(\"leave\")` resolves as the row leaves. Either way the row's own code has gone by then, so what runs is plain DOM work. Wardic's reduced motion can't reach a Web Animation of your own, so the row reads it itself: the system's setting and the header's switch.",
    ],
    reducedMotion: "Nothing flies: a row moved to the cart or removed fades, and the rows below move up at once.",
    uses: ["usePresence", "AnimatePresence custom", "mode=\"popLayout\"", "Web Animations"],
    motion: {
      file: "saved.tsx",
      note: "Motion's `usePresence` returns `[isPresent, safeToRemove]`, and the component runs its own exit in an effect once `isPresent` turns false: React keeps a leaving component rendering. Solid has disposed the row's code by the time it leaves, so Wardic calls you instead, once, as it leaves: a callback given to `usePresence` on Solid 1, the handle's `next(\"leave\")` on Solid 2. The presence's `custom` comes with it, where Motion reads it through `usePresenceData`. And Motion's `popLayout` hands each child a `ref` to pass on to its element; Wardic's finds the leaving element itself.",
    },
    interact: ".saved-row:first-child .button.accent",
    watch: ".saved-row:nth-child(2)",
  },
  {
    id: "magnifier",
    area: "live",
    title: "A closer look at the glaze",
    summary: "Hover over the vase and a lens follows your pointer, gliding after it and settling where you stop.",
    why: [
      "A product photo hides what makes a glazed piece worth buying: where its colours run into each other. A magnifier lets you look closer without leaving the page. A lens glued to the pointer jitters with every twitch of the hand; on a spring, it glides after the pointer and settles where you stop.",
      "The pointer's place over the photo is two plain signals. `createSpring` follows each with a spring on the frame loop, idle while it rests, and the lens takes the springs as its `x` and `y` in `style`: live values, which Wardic writes each frame. `createTransform` maps the same springs to where the photo inside the lens sits, as two custom properties the stylesheet's `background-position` reads, so the lens always shows what's under its centre.",
      "The lens grows in under hover or a press: the photo names a variant, and the lens, a Variant child, follows it.",
    ],
    reducedMotion: "The lens doesn't glide: it's where the pointer is. A live value is yours, so Wardic's reduced motion leaves it alone; the demo `jump`s its springs to the pointer instead.",
    uses: ["createSpring", "createTransform", "live values in style", "whileHover", "whileTap"],
    motion: {
      file: "magnifier.tsx",
      note: "Motion's `useSpring` and `useTransform` are `createSpring` and `createTransform`, made in the component's body. Motion would join the two values into one `background-position` with `useMotionTemplate`; Wardic has no template helper, so each value maps to a custom property of its own, and the stylesheet joins them.",
    },
    interact: ".magnifier-photo",
    watch: ".lens",
  },
  {
    id: "reading-progress",
    area: "live",
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
    area: "live",
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
    area: "live",
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
    area: "live",
    title: "Cards that catch the light",
    summary: "Move over a piece and its card tilts toward your pointer, with a soft light under it that follows.",
    why: [
      "A card that answers the pointer feels like an object: tilting toward where you point, with a light where your pointer is, it invites a closer look without a single extra control.",
      "The pointer's place over the card, from -1 to 1 each way, is two signals that two `createSpring`s follow, so the card eases toward the pointer and back to rest when it leaves. `createTransform` maps the springs twice: to `rotateX` and `rotateY` in the card's `style`, and to where its light sits, as custom properties the stylesheet's radial gradient reads. The light comes on through a variant that animates a custom property of its own, `--light`, from 0 to 1 under hover.",
      "The card hears its hover from Wardic. On Solid 2, its ward is made beside the effects that read it and given to the element through `wardRef`. It only listens (`ward()`): the card's own props light it and tilt it. An effect over `card.when(\"hover\")` hears the pointer over the card, from where it came in and at each move, with the card it's over (`element`, so no `ref`), and places the light and the tilt; one over `card.when(\"hoverEnd\")` sends the card back flat. A `hover` at each move is Wardic's own: Motion's hover has only a start and an end. On Solid 1, the element's `onHoverStart` and `onHoverEnd` do the same, with its own `pointermove` for the moves in between. Touch never hovers, so on a phone the cards stay still.",
    ],
    reducedMotion: "The cards don't tilt, and the light is where the pointer is, without the spring. It still comes on and goes off.",
    uses: ["createSpring", "createTransform", "custom properties in style and variants", "whileHover", "when(\"hover\") (Solid 2)"],
    interact: "drag:.spot-grid li:first-child .spot-card:60:40",
    watch: ".spot-grid li:first-child .spot-card",
  },
  {
    id: "before-hydration",
    area: "server",
    title: "A banner that arrives before the JavaScript",
    summary: "The season's banner plays its entrance from the first paint, whether the JavaScript is late or never comes.",
    why: [
      "A server-rendered page is on screen before its JavaScript has loaded. An entrance that waits for the JavaScript waits on the network: the banner sits blank, then starts late, or never with the JavaScript off. Wardic writes each element's entrance into the page as a CSS animation, sampled from the same spring or tween the browser would run, so the banner moves from the first paint, from the HTML and its stylesheet alone.",
      "When the JavaScript arrives, Wardic takes each element over from where its CSS has drawn it, by the time that has passed, and carries on with the same spring: no jump, mid-flight or after the end. With no JavaScript, the CSS plays to the end and holds. There's nothing to turn on: every `initial` and `animate` on a server-rendered page gets one, variants and their stagger included.",
      "Try it with the links under the banner. \"Hydrate 2 s late\" holds the JavaScript back, as a slow network would, and \"Don't hydrate\" never runs it, as with the JavaScript off. The line above them says when the JavaScript took over.",
    ],
    reducedMotion: "The photo and lines still fade in one after another, but nothing rises or settles. Before the JavaScript, the page's CSS follows your system's reduced-motion setting; the header's switch counts once the JavaScript has run.",
    uses: ["initial", "animate", "variants", "staggerChildren", "server-rendered CSS"],
    motion: {
      file: "before-hydration.tsx",
      note: "The code is the same; what the server sends isn't. Motion renders `initial` and waits for React: until the JavaScript has loaded and hydrated, the banner is at `opacity: 0`, and with the JavaScript off it stays that way. Motion's nearest is its optimised appear animations (`startOptimizedAppearAnimation`), which need an inline script of your own to start them, and do nothing without JavaScript.",
    },
    watch: ".season-copy h2",
  },
]

/** The examples of an area, in the registry's order. */
export const examplesIn = (area: AreaId): ReadonlyArray<Example> => EXAMPLES.filter((example) => example.area === area)

/** An example by its id. */
export const exampleById = (id: string): Example | undefined => EXAMPLES.find((example) => example.id === id)

/** An example's route. */
export const routeOf = (example: Example): string => `/${example.area}/${example.id}`
