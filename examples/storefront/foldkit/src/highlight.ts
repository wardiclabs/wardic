/**
 * The code panels (#795): an example's files in this app, `Demo.ts` first, and Motion's beside them,
 * each highlighted on the server with Shiki for both themes, read here through Vite's raw globs so
 * the browser never downloads a source to show it. The server entry runs it for the Flags, and the
 * rpc for a page reached by a link.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { APPS, appUrl } from "@wardic/example-storefront-shared/apps"
import { highlightOptions, inShowingOrder } from "@wardic/example-storefront-shared/code"
import { exampleById, routeOf } from "@wardic/example-storefront-shared/examples"
import { InvalidArguments } from "@wardic/example-storefront-shared/server"
import { codeToHtml } from "shiki"
import type { Code, Highlighted } from "~/shop.ts"

/** This app's examples: every file in each folder. */
const OWN = import.meta.glob<string>("./examples/*/*.ts", { query: "?raw", import: "default", eager: true })
const OWN_SRC = "./"

/** Each example's Motion version (#366): every file in its folder in the Next.js app. */
const MOTION = import.meta.glob<string>("../../next/src/examples/*/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })
const MOTION_SRC = "../../next/src/"

/** The files of `sources` under `folder`, in showing order, each highlighted. */
const filesIn = (sources: Readonly<Record<string, string>>, src: string, folder: string): Effect.Effect<ReadonlyArray<Highlighted>> =>
  Effect.forEach(
    inShowingOrder(Object.keys(sources).filter((key) => key.startsWith(`${src}${folder}/`))),
    (key) => Effect.promise(() => codeToHtml(sources[key], highlightOptions(key))).pipe(Effect.map((html) => ({ path: key.slice(src.length), html }))),
  )

/**
 * An example's code: this app's files for it, Motion's, and where Motion's runs, on the host this
 * page was asked for (`shared/src/apps.ts`).
 */
export const highlightedCode = (exampleId: string, host: string | undefined): Effect.Effect<Code, InvalidArguments> =>
  Effect.gen(function* () {
    const example = yield* Option.match(Option.fromUndefinedOr(exampleById(exampleId)), {
      onNone: () => Effect.fail(new InvalidArguments({ reason: `there's no example "${exampleId}"` })),
      onSome: Effect.succeed,
    })
    const own = yield* filesIn(OWN, OWN_SRC, `examples/${exampleId}`)
    const motion = yield* filesIn(MOTION, MOTION_SRC, `examples/${exampleId}`)
    return { own, motion, run: appUrl(APPS.next, routeOf(example), host, process.env) }
  })
