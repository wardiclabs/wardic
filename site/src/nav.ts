/** The sidebar (#558): each section's pages, in reading order. A page not listed here is still served. */
import TITLES from "virtual:page-titles"

export interface NavPage {
  readonly path: string
  readonly title: string
}

/** A family of pages in a section, one collapsible group in the sidebar: the reference's (#558). */
export interface NavGroup {
  readonly title: string
  readonly pages: ReadonlyArray<NavPage>
}

export interface NavSection {
  readonly title: string
  readonly pages: ReadonlyArray<NavPage>
  /** Its families, after its pages, each open while one of its pages is. */
  readonly groups?: ReadonlyArray<NavGroup>
}

/**
 * A generated reference's modules, `reference/core/*` say, from the page titles: each module's page,
 * by its title, leaving out the package's index and each module's internal types.
 */
const modulesOf = (dir: string): ReadonlyArray<NavPage> =>
  Object.entries(TITLES)
    .filter(([name]) => name.startsWith(`reference/${dir}/`) && !name.endsWith("/index") && !name.endsWith("/internal"))
    .map(([name, title]) => ({ path: `/${name}`, title }))
    .sort((a, b) => a.title.localeCompare(b.title))

/** A generated reference's index page, once its package has a module published. */
const indexOf = (dir: string, title: string): ReadonlyArray<NavPage> =>
  TITLES[`reference/${dir}/index`] === undefined ? [] : [{ path: `/reference/${dir}`, title }]

/** A group of a generated reference's modules, once it has one. */
const groupOf = (title: string, pages: ReadonlyArray<NavPage>): ReadonlyArray<NavGroup> => (pages.length === 0 ? [] : [{ title, pages }])

export const NAV: ReadonlyArray<NavSection> = [
  {
    title: "Start",
    pages: [
      { path: "/", title: "What Wardic is" },
      { path: "/start/solid-1", title: "Start on Solid 1" },
      { path: "/start/solid-2", title: "Start on Solid 2" },
      { path: "/motion", title: "Coming from Motion" },
    ],
  },
  {
    title: "Guides",
    pages: [
      { path: "/guides/animate", title: "Animate an element" },
      { path: "/guides/transitions", title: "Transitions" },
      { path: "/guides/variants", title: "Variants" },
      { path: "/guides/gestures", title: "Gestures" },
      { path: "/guides/drag", title: "Drag" },
      { path: "/guides/layout", title: "Layout animations" },
      { path: "/guides/presence", title: "Exit animations" },
      { path: "/guides/reorder", title: "Reorder" },
      { path: "/guides/scroll", title: "Scroll" },
      { path: "/guides/live-values", title: "Live values" },
    ],
  },
  {
    title: "In production",
    pages: [
      { path: "/guides/server-rendering", title: "Server rendering" },
      { path: "/guides/features", title: "Shipping less" },
      { path: "/guides/reduced-motion", title: "Reduced motion" },
      { path: "/guides/testing", title: "Testing" },
      { path: "/guides/observability", title: "Observability" },
    ],
  },
  {
    title: "Reference",
    pages: [
      { path: "/reference/solid", title: "Solid reference" },
      ...indexOf("core", "Core reference"),
      ...indexOf("dom", "DOM reference"),
    ],
    groups: [
      {
        title: "Elements",
        pages: [
          { path: "/reference/solid/elements/w", title: "w" },
          { path: "/reference/solid/elements/wardic", title: "wardic" },
          { path: "/reference/solid/elements/ward", title: "Wards" },
          { path: "/reference/solid/elements/ward-events", title: "Ward events" },
          { path: "/reference/solid/elements/props", title: "Motion props" },
        ],
      },
      {
        title: "Provider",
        pages: [
          { path: "/reference/solid/provider/wardic-provider", title: "WardicProvider" },
          { path: "/reference/solid/provider/wardic-config", title: "WardicConfig" },
          { path: "/reference/solid/provider/lazy-wardic", title: "LazyWardic" },
          { path: "/reference/solid/provider/features", title: "Features" },
        ],
      },
      {
        title: "Presence",
        pages: [
          { path: "/reference/solid/presence/animate-presence", title: "AnimatePresence" },
          { path: "/reference/solid/presence/use-presence", title: "usePresence" },
          { path: "/reference/solid/presence/use-is-present", title: "useIsPresent" },
          { path: "/reference/solid/presence/use-presence-data", title: "usePresenceData" },
          { path: "/reference/solid/presence/create-presence", title: "createPresence" },
          { path: "/reference/solid/presence/presence-context", title: "PresenceContext" },
        ],
      },
      {
        title: "Layout",
        pages: [
          { path: "/reference/solid/layout/layout-group", title: "LayoutGroup" },
          { path: "/reference/solid/layout/use-animate-layout", title: "useAnimateLayout" },
          { path: "/reference/solid/layout/create-instant-transition", title: "createInstantTransition" },
          { path: "/reference/solid/layout/create-instant-layout-transition", title: "createInstantLayoutTransition" },
          { path: "/reference/solid/layout/create-reset-projection", title: "createResetProjection" },
          { path: "/reference/solid/layout/measure-layout-box", title: "measureLayoutBox" },
          { path: "/reference/solid/layout/use-layout-member", title: "useLayoutMember" },
        ],
      },
      {
        title: "Reorder",
        pages: [
          { path: "/reference/solid/reorder/reorder", title: "Reorder" },
          { path: "/reference/solid/reorder/reorder-group", title: "Reorder groups" },
          { path: "/reference/solid/reorder/reorder-item", title: "Reorder items" },
        ],
      },
      {
        title: "Gestures",
        pages: [
          { path: "/reference/solid/gestures/create-hover", title: "createHover" },
          { path: "/reference/solid/gestures/create-press", title: "createPress" },
          { path: "/reference/solid/gestures/create-focus", title: "createFocus" },
          { path: "/reference/solid/gestures/create-in-view", title: "createInView" },
          { path: "/reference/solid/gestures/create-page-in-view", title: "createPageInView" },
          { path: "/reference/solid/gestures/create-drag", title: "createDrag" },
          { path: "/reference/solid/gestures/create-drag-controls", title: "createDragControls" },
        ],
      },
      {
        title: "Live values",
        pages: [
          { path: "/reference/solid/live-values/create-transform", title: "createTransform" },
          { path: "/reference/solid/live-values/create-spring", title: "createSpring" },
          { path: "/reference/solid/live-values/create-follow-value", title: "createFollowValue" },
          { path: "/reference/solid/live-values/create-velocity", title: "createVelocity" },
          { path: "/reference/solid/live-values/create-time", title: "createTime" },
          { path: "/reference/solid/live-values/create-scroll", title: "createScroll" },
          { path: "/reference/solid/live-values/create-animation-frame", title: "createAnimationFrame" },
          { path: "/reference/solid/live-values/create-will-change", title: "createWillChange" },
        ],
      },
      {
        title: "Animation",
        pages: [
          { path: "/reference/solid/animation/create-animate", title: "createAnimate" },
          { path: "/reference/solid/animation/sequences", title: "Sequences" },
          { path: "/reference/solid/animation/create-animation-controls", title: "createAnimationControls" },
        ],
      },
      {
        title: "Transitions",
        pages: [
          { path: "/reference/solid/transitions/transition", title: "transition" },
          { path: "/reference/solid/transitions/easing", title: "Easing" },
          { path: "/reference/solid/transitions/stagger", title: "stagger" },
          { path: "/reference/solid/transitions/arc", title: "arc" },
        ],
      },
      {
        title: "Utilities",
        pages: [
          { path: "/reference/solid/utilities/create-cycle", title: "createCycle" },
          { path: "/reference/solid/utilities/create-reduced-motion", title: "createReducedMotion" },
          { path: "/reference/solid/utilities/page-points", title: "Page points" },
          { path: "/reference/solid/utilities/component-checks", title: "Component checks" },
          { path: "/reference/solid/utilities/version", title: "VERSION" },
        ],
      },
      {
        title: "Advanced",
        pages: [
          { path: "/reference/solid/advanced/runtime", title: "The runtime" },
          { path: "/reference/solid/advanced/bridges", title: "Bridges" },
          { path: "/reference/solid/advanced/flush-gate", title: "The flush gate" },
          { path: "/reference/solid/advanced/variant-context", title: "Variant context" },
          { path: "/reference/solid/advanced/run-drag-track", title: "runDragTrack" },
        ],
      },
      // Core's and dom's modules, generated at build (scripts/reference.ts), as each is published.
      ...groupOf("Core", modulesOf("core")),
      ...groupOf("DOM", modulesOf("dom")),
    ],
  },
]
