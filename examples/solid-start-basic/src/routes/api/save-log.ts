// `POST /api/save-log`: the /ssr and /appear routes' "Save log to repo" buttons (ADR-0021's,
// ADR-0044's hand checks), shared with the Solid 2 example (`@wardic/example-hand-checks`). Saving
// runs in dev (`bun dev`), or a production build started with WARDIC_SAVE_LOG=1; the logs land in
// examples/solid-start-basic/logs/.
import type { APIEvent } from "@solidjs/start/server"
import { saveLog } from "@wardic/example-hand-checks/save-log"

export const POST = ({ request }: APIEvent): Promise<Response> =>
  saveLog(request, { enabled: import.meta.env.DEV || process.env.WARDIC_SAVE_LOG === "1", example: "solid-start-basic" })
