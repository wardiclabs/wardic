/**
 * The studio's stories (#388): the words the Live values examples scroll through, kept here so each
 * demo's code is about its motion. Made up for the showcase, as the catalog's words are.
 */

/** One part of a story: a heading and its paragraphs. */
export interface StorySection {
  readonly heading: string
  readonly paragraphs: ReadonlyArray<string>
}

/** "How the Lagoon glaze is made": the reading progress example's article. */
export const LAGOON_ARTICLE: { readonly title: string; readonly minutes: number; readonly sections: ReadonlyArray<StorySection> } = {
  title: "How the Lagoon glaze is made",
  minutes: 4,
  sections: [
    {
      heading: "Two glazes, one kiln",
      paragraphs: [
        "Every Lagoon Vase starts as a plain stoneware body, thrown on the wheel and left to dry for a week under a loose sheet of plastic, so its walls dry evenly and nothing cracks at the rim.",
        "It gets two glazes, not one. The first is a pale celadon that we dip; the second, a deep cobalt blue, is poured over it from the shoulder down while the vase turns slowly on a banding wheel.",
      ],
    },
    {
      heading: "Letting the heat decide",
      paragraphs: [
        "At 1,280 degrees both glazes melt. The cobalt is heavier and runs down through the celadon, carrying it with it in streaks, and where the two meet they mix into the greens the vase is named for.",
        "We can choose how thick each coat is and where the pour starts, but not where the glazes go after that. The kiln decides. That's why no two vases are alike, and why we open the kiln slowly.",
        "A firing takes eleven hours to climb and two days to cool. Opened too soon, the glaze crazes: fine cracks run through it as it cools faster than the clay beneath.",
      ],
    },
    {
      heading: "Choosing the ones that stay",
      paragraphs: [
        "Not every firing gives us vases we sell. A glaze that ran too far pools at the foot and fuses the vase to its shelf; one that ran too little stays a flat, even blue. We keep the ones in between.",
        "Each of those is checked for pinholes, sanded at the foot, and filled with water overnight to be sure it holds. Then it's photographed on the same white sheet as every other piece in the shop.",
      ],
    },
    {
      heading: "Looking after one",
      paragraphs: [
        "The glaze is glass, so it's watertight and wipes clean. Wash it by hand in warm water; a dishwasher's detergent dulls the surface over the years.",
        "If you want to see the runs at their best, put it where light comes from the side: the thicker streaks catch it, and the thin ones let the pale glaze through.",
      ],
    },
  ],
}

/** One chapter of the studio's story, with a piece's photo: the reveals example's. */
export interface Chapter {
  readonly title: string
  readonly text: string
  readonly photo: string
}

export const STUDIO_CHAPTERS: ReadonlyArray<Chapter> = [
  {
    title: "A shed at the end of the garden",
    text: "The studio began with one wheel and a second-hand kiln in a shed, firing a dozen pots a month for friends.",
    photo: "moon-vase",
  },
  {
    title: "The first glaze that ran",
    text: "A firing that went too hot turned a plain blue into streams of green. It was meant to be a mistake; it became the Lagoon.",
    photo: "lagoon-vase",
  },
  {
    title: "Glass, next door",
    text: "A glassblower took the workshop beside ours, and the carafes and tumblers in the shop come from her bench.",
    photo: "cut-carafe",
  },
  {
    title: "Twelve pieces, made in small runs",
    text: "We still make everything in batches of a few dozen, so a piece that sells out comes back when the next firing cools.",
    photo: "blossom-jar",
  },
]

/** A collection's banner: the parallax example's lookbook. */
export interface Collection {
  readonly title: string
  readonly blurb: string
  readonly photo: string
}

export const LOOKBOOK: ReadonlyArray<Collection> = [
  { title: "Vases", blurb: "Thrown in one piece, glazed to run.", photo: "lagoon-vase" },
  { title: "Bowls", blurb: "For the table, and for keeping things in.", photo: "celadon-bowl" },
  { title: "Glass", blurb: "Blown next door, cut by hand.", photo: "cut-carafe" },
]
