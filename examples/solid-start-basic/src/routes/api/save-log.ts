// `POST /api/save-log`: the `/ssr` route's "Save log to repo" button (ADR-0021's hand check).
// Writes the posted JSON to `logs/<ISO timestamp>.json` in this example (gitignored), so
// a hand-run session can be read back from the repo. The same contract as the layout lab's
// save-log (examples/layout-lab/vite.config.ts): same-origin, JSON only, 64 MiB at most.
//
// The example's scripts run from its own directory (`bun dev`, `bun start`), so the logs
// land in examples/solid-start-basic/logs/ in dev and in a production build alike.
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { APIEvent } from "@solidjs/start/server"

const MAX_LOG_BYTES = 64 * 1024 * 1024

const reply = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export async function POST({ request }: APIEvent): Promise<Response> {
  const origin = request.headers.get("origin")
  const host = request.headers.get("host")
  if (origin !== null && new URL(origin).host !== host) return reply(403, { error: "same-origin only" })
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return reply(415, { error: "expected application/json" })
  }
  const body = await request.text()
  if (body.length > MAX_LOG_BYTES) return reply(413, { error: `log exceeds ${MAX_LOG_BYTES} bytes` })
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
  return reply(200, { path: `examples/solid-start-basic/logs/${file}` })
}
