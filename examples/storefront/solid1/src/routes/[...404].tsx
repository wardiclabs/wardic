import { A } from "@solidjs/router"
import { HttpStatusCode } from "@solidjs/start"

export default function NotFound() {
  return (
    <main class="page hero">
      <HttpStatusCode code={404} />
      <h1>Nothing on this shelf.</h1>
      <p>
        <A href="/">Back to the examples</A>
      </p>
    </main>
  )
}
