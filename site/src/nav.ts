/** The sidebar (#558): each section's pages, in reading order. A page not listed here is still served. */

export interface NavPage {
  readonly path: string
  readonly title: string
}

export interface NavSection {
  readonly title: string
  readonly pages: ReadonlyArray<NavPage>
}

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
    ],
  },
]
