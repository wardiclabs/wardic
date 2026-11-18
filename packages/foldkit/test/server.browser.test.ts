// The package's `server` condition in a browser (#794, PR 1, Q8): the `default` export resolves the client's half.
//
// - SB1: `IS_SERVER` reads false in a browser; the SSR tier's S0 reads it true under Node.
import { expect, it } from "vitest"
import { IS_SERVER } from "@wardic/foldkit/internal/server"

it("SB1: the server condition reads false in a browser", () => {
  expect(IS_SERVER).toBe(false)
})
