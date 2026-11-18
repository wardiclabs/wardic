/**
 * The production host (#795, Q4): `@foldkit/node` serves the build (`vite build`: the client's files,
 * and the server entry as a fetch handler) on `PORT`, 4104 by default, behind `ORIGIN` where a proxy
 * fronts it. `node server.ts`, from this directory; the smoke test and the deployment both run it.
 */
import { NodeRuntime } from "@effect/platform-node"
import * as Node from "@foldkit/node"
import * as Config from "effect/Config"
import * as Option from "effect/Option"
import * as Str from "effect/String"

const port = Config.withDefault(Config.Port("PORT"), 4104)
const origin = Config.option(Config.String("ORIGIN")).pipe(Config.map(Option.filter(Str.isNonEmpty)))

NodeRuntime.runMain(Node.serve({ port, origin }))
