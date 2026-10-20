// The server entry (start mode's authored pair, with entry-client.tsx): the document and the app,
// streamed, as the plugin's generated entry renders them.
import { getRequestEvent, renderToStream } from "@solidjs/web"
import manifest from "virtual:solid-manifest"
import App from "./App.tsx"
import Document from "./Document.tsx"

export function render() {
  return renderToStream(
    () => (
      <Document>
        <App />
      </Document>
    ),
    { manifest, nonce: getRequestEvent()?.nonce ?? undefined },
  )
}
