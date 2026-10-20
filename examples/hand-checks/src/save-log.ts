// `POST /api/save-log`'s body, shared by the start examples (#209): the hand checks' "Save log to
// repo" buttons (ADR-0021's, ADR-0044's). Writes the posted JSON to `logs/<ISO timestamp>.json` in
// the example running it (gitignored), so a hand-run session can be read back from the repo.
//
// It follows the layout lab's save-log (examples/layout-lab/vite.config.ts): same-origin, JSON
// only, 64 MiB at most (it stops reading past that), and only where a developer runs it: the
// example's route passes `enabled` (in dev, or a production build started with WARDIC_SAVE_LOG=1).
// Anywhere else it answers 404, so a deployed example never writes to its disk.
//
// An example's scripts run from its own directory, so the logs land in its logs/ either way.
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const MAX_LOG_BYTES = 64 * 1024 * 1024

const reply = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** The request's host, or `undefined` for an origin that isn't a URL (`Origin: null`). */
const hostOf = (origin: string): string | undefined => {
  try {
    return new URL(origin).host
  } catch {
    return undefined
  }
}

/** The body as UTF-8 text, or `undefined` once it passes MAX_LOG_BYTES (reading stops there). */
const readCapped = async (request: Request): Promise<string | undefined> => {
  const reader = request.body?.getReader()
  if (reader === undefined) return ""
  const chunks: Array<Uint8Array> = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_LOG_BYTES) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** Where saving runs, and the example's directory under examples/ (for the path it answers with). */
export interface SaveLogOptions {
  readonly enabled: boolean
  readonly example: string
}

/** Answer a `POST /api/save-log`: write the log and answer with its path in the repo. */
export const saveLog = async (request: Request, options: SaveLogOptions): Promise<Response> => {
  if (!options.enabled) return reply(404, { error: "not found" })
  const origin = request.headers.get("origin")
  if (origin !== null && hostOf(origin) !== request.headers.get("host")) return reply(403, { error: "same-origin only" })
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return reply(415, { error: "expected application/json" })
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_LOG_BYTES) {
    return reply(413, { error: `log exceeds ${MAX_LOG_BYTES} bytes` })
  }
  const body = await readCapped(request)
  if (body === undefined) return reply(413, { error: `log exceeds ${MAX_LOG_BYTES} bytes` })
  let log: unknown
  try {
    log = JSON.parse(body)
  } catch {
    return reply(400, { error: "body is not valid JSON" })
  }
  const dir = join(process.cwd(), "logs")
  const file = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, file), `${JSON.stringify(log, null, 2)}\n`)
  } catch (error) {
    return reply(500, { error: String(error) })
  }
  return reply(200, { path: `examples/${options.example}/logs/${file}` })
}
