/**
 * The production host (#795, Q4): `@foldkit/node` serves the build (`vite build`: the client's files,
 * and the server entry as a fetch handler) on `PORT`, 4104 by default, behind `ORIGIN` where a proxy
 * fronts it. `node server.ts`, from this directory; the smoke test and the deployment both run it.
 *
 * At its start it writes `robots.txt` and the sitemap into the client's files (#908), for the origin it
 * serves: the host answers a path with an extension from its files alone, never the server entry.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeRuntime } from "@effect/platform-node"
import * as Node from "@foldkit/node"
import { robotsTxtOf, sitemapOf } from "@wardic/example-storefront-shared/seo"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Str from "effect/String"

const port = Config.withDefault(Config.Port("PORT"), 4104)
const origin = Config.option(Config.String("ORIGIN")).pipe(Config.map(Option.filter(Str.isNonEmpty)))

/** `robots.txt` and the sitemap, for the origin it serves: `ORIGIN`, else the host's own, as `Node.serve` derives it. */
const crawlerFiles = Effect.gen(function* () {
  const given = yield* origin
  const listening = yield* port
  const served = Option.getOrElse(given, () => `http://localhost:${listening}`)
  writeFileSync(join("dist", "client", "robots.txt"), robotsTxtOf("foldkit", served))
  writeFileSync(join("dist", "client", "sitemap.xml"), sitemapOf("foldkit", served))
})

NodeRuntime.runMain(Effect.andThen(crawlerFiles, Node.serve({ port, origin })))
