// The layout lab's "Save log to repo" route, shared by its two builds (vite.config.ts on Solid 1,
// vite.v2.config.ts on Solid 2).
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin } from "vite"

/** The dev-server route the lab's "Save log to repo" button POSTs to (`src/ui/CopyLog.tsx`). */
const SAVE_LOG_ROUTE = "/__lab/save-log"
const MAX_LOG_BYTES = 64 * 1024 * 1024

/**
 * Dev-only: accepts the lab log as a JSON POST and writes it to
 * `logs/<timestamp>-<binding>-<schedulerMode>.json` (gitignored; the binding is the log's
 * `binding`, `solid1` or `solid2`, #209 PR 5), so a full session's runs
 * can be read from disk rather than pasted. The server picks the filename; the
 * body only has to parse as JSON. Requests from another origin, or without a JSON
 * content type, are refused, so a page open elsewhere in the browser can't write
 * through it.
 */
export const saveLogPlugin = (): Plugin => ({
  name: "layout-lab:save-log",
  apply: "serve",
  configureServer(server) {
    const dir = join(server.config.root, "logs")
    server.middlewares.use(SAVE_LOG_ROUTE, (req, res) => {
      const reply = (status: number, body: Record<string, unknown>): void => {
        res.statusCode = status
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify(body))
      }
      if (req.method !== "POST") return reply(405, { error: "POST only" })
      const origin = req.headers.origin
      if (origin !== undefined && new URL(origin).host !== req.headers.host) {
        return reply(403, { error: "same-origin only" })
      }
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return reply(415, { error: "expected application/json" })
      }
      const chunks: Array<Buffer> = []
      let size = 0
      req.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_LOG_BYTES) {
          reply(413, { error: `log exceeds ${MAX_LOG_BYTES} bytes` })
          req.destroy()
        } else {
          chunks.push(chunk)
        }
      })
      req.on("end", () => {
        if (res.writableEnded) return
        let log: unknown
        try {
          log = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        } catch {
          return reply(400, { error: "body is not valid JSON" })
        }
        const rawMode = (log as { schedulerMode?: unknown } | null)?.schedulerMode
        const mode = typeof rawMode === "string" && /^[a-z]{1,16}$/.test(rawMode) ? rawMode : "unknown"
        const rawBinding = (log as { binding?: unknown } | null)?.binding
        const binding = typeof rawBinding === "string" && /^solid[12]$/.test(rawBinding) ? rawBinding : "unknown"
        const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-${binding}-${mode}.json`
        mkdir(dir, { recursive: true })
          .then(() => writeFile(join(dir, file), `${JSON.stringify(log, null, 2)}\n`))
          .then(
            () => reply(200, { path: `examples/layout-lab/logs/${file}` }),
            (error: unknown) => reply(500, { error: String(error) }),
          )
      })
    })
  },
})
