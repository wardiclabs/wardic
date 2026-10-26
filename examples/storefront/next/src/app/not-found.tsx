import Link from "next/link"

export default function NotFound() {
  return (
    <main className="page hero">
      <h1>Nothing on this shelf.</h1>
      <p>
        <Link href="/">Back to the examples</Link>
      </p>
    </main>
  )
}
