/**
 * Wardic's mark and wordmark, the header's link home: Cassiopeia's W on its ward ring, drawn on the
 * page's first paint. The ring draws round from its hairline top while each star lands along the W,
 * Segin to Caph, clearing its place in the ring and the lines, and the line to the next star draws as
 * it lands; hovering the link draws the W again.
 *
 * Its parts are Variant children of the link (Layout.tsx), which names the variants: `hidden` to
 * `shown` as it mounts, which the server plays as CSS before the page hydrates, then `rest`, and
 * `hover`. A hover's end goes back to what `animate` names, with that variant's transition, as
 * Motion's does: `shown` lands each part on its beat, so once every star has landed (`onLanded`) the
 * link names `rest`, the same values with no delay, and the W comes back at once. Under
 * `prefers-reduced-motion` the stars' scale snaps while the lines and the ring still draw, as Motion
 * does. Its geometry is the mark's small cut (logo-paths.ts). The page has one Logo, so its ids are
 * fixed.
 */
import { w, type Ward, type WardicVariants } from "@wardic/solid/unstable/v2"
import { For, onSettled } from "solid-js"
import { LINES, RING, STARS, WORDMARK } from "~/components/logo-paths.ts"

/** When star `i` lands along the W, in seconds: one every 180 ms, once the ring has started round. */
const landsAt = (i: number): number => 0.3 + i * 0.18

/** How much each star bounces as it lands: Navi, the brightest, the most. */
const DAMPING: ReadonlyArray<number> = [22, 22, 12, 22, 22]

/** Star `i`'s landing: a spring, on its beat. Its clearing opens on the same one. */
const landing = (i: number) => ({ type: "spring", stiffness: 520, damping: DAMPING[i], delay: landsAt(i) }) as const

/** The ring's reveal: a stroke round its middle, drawn from the top, that masks it. */
const SWEEP: WardicVariants = {
  hidden: { pathLength: 0 },
  shown: { pathLength: 1, transition: { type: "tween", duration: 0.8, ease: "easeInOut" } },
  rest: { pathLength: 1 },
}

/** A star, by its place along the W: it lands on a spring and fades in as it does; on hover it twinkles, each in turn. */
const STAR: WardicVariants = {
  hidden: { scale: 0, opacity: 0 },
  shown: (i: number) => ({ scale: 1, opacity: 1, transition: { ...landing(i), opacity: { type: "tween", duration: 0.15, delay: landsAt(i) } } }),
  rest: (i: number) => ({ scale: 1, opacity: 1, transition: { ...landing(i), delay: 0 } }),
  hover: (i: number) => ({ scale: [1, 1.3, 1], transition: { type: "tween", duration: 0.32, delay: i * 0.06 } }),
}

/** A star's clearing: it opens in the ring and the lines as the star lands, so the ring draws whole until then. */
const GAP: WardicVariants = {
  hidden: { scale: 0 },
  shown: (i: number) => ({ scale: 1, transition: landing(i) }),
  rest: { scale: 1 },
}

/** A line, by the star it leaves: it draws as that star lands, and again, quicker, on hover. */
const LINE: WardicVariants = {
  hidden: { pathLength: 0 },
  shown: (i: number) => ({ pathLength: 1, transition: { type: "tween", duration: 0.16, ease: "easeOut", delay: landsAt(i) + 0.06 } }),
  rest: { pathLength: 1, transition: { type: "tween", duration: 0.16, ease: "easeOut" } },
  hover: (i: number) => ({ pathLength: [0, 1], transition: { type: "tween", duration: 0.18, ease: "easeOut", delay: i * 0.06 } }),
}

/**
 * The mark and the wordmark. `onLanded` is told once every star has landed: the stars land last of the
 * parts, Caph last of all, on the last beat.
 */
export function Logo(props: { readonly onLanded: () => void }) {
  const stars: Array<Ward> = []
  // onSettled runs in the browser only. A star disposed before it lands rejects its promise, and then there's nothing to tell.
  onSettled(() => {
    Promise.all(stars.map((star) => star.next("settled"))).then(
      () => props.onLanded(),
      () => {},
    )
  })
  return (
    <>
      <svg class="logo-mark" viewBox="0 0 128 128" width="36" height="36" aria-hidden="true">
        <defs>
          <linearGradient id="wardic-logo-ring" gradientUnits="userSpaceOnUse" x1="8" y1="64" x2="120" y2="64">
            <stop offset="0" stop-color="#8fbcbb" />
            <stop offset=".38" stop-color="#88c0d0" />
            <stop offset=".68" stop-color="#81a1c1" />
            <stop offset="1" stop-color="#b48ead" />
          </linearGradient>
          <For each={LINES}>
            {(line, i) => (
              <linearGradient id={`wardic-logo-line-${i()}`} gradientUnits="userSpaceOnUse" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}>
                <stop offset=".15" stop-color={line.from} />
                <stop offset=".85" stop-color={line.to} />
              </linearGradient>
            )}
          </For>
          {/* The clearing round each star, which the ring and the lines stop short of, opening as it lands. */}
          <mask id="wardic-logo-gaps" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
            <rect width="128" height="128" fill="#fff" />
            <For each={STARS}>
              {(star, i) => <w.path d={star.gap} fill="#000" stroke="#000" stroke-width="5.2" stroke-linejoin="round" custom={i()} variants={GAP} />}
            </For>
          </mask>
          {/* The ring is one filled shape, so it draws through a mask: a stroke round its middle, from the top. */}
          <mask id="wardic-logo-sweep" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
            <g transform="rotate(-90 64 64)">
              <w.circle cx="64" cy="64" r="56" fill="none" stroke="#fff" stroke-width="10" variants={SWEEP} />
            </g>
          </mask>
        </defs>
        <g transform="translate(64 64) scale(0.89) translate(-64 -64)">
          <circle cx="64" cy="64" r="56" fill="#242933" />
          <g mask="url(#wardic-logo-gaps)">
            <path d={RING} fill="url(#wardic-logo-ring)" fill-rule="evenodd" mask="url(#wardic-logo-sweep)" />
            <For each={LINES}>
              {(line, i) => (
                <w.path
                  d={`M${line.x1} ${line.y1}L${line.x2} ${line.y2}`}
                  fill="none"
                  stroke={`url(#wardic-logo-line-${i()})`}
                  stroke-width="4.5"
                  custom={i()}
                  variants={LINE}
                />
              )}
            </For>
          </g>
          <For each={STARS}>
            {(star, i) => <w.path d={star.d} fill="#242933" stroke={star.color} stroke-width="3.6" stroke-linejoin="round" custom={i()} variants={STAR} wardRef={(ward) => stars.push(ward)} />}
          </For>
        </g>
      </svg>
      <svg class="logo-word" viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} width="87" height="21" aria-hidden="true">
        <path d={WORDMARK.d} fill="currentColor" />
      </svg>
    </>
  )
}
