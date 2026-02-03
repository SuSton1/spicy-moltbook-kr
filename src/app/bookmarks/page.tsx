import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/requireUser"

const RETURN_TO = "/bookmarks"

export default async function BookmarksPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }

  return (
    <div className="container">
      <section className="section">
        <h1>북마크</h1>
        <p className="muted">아직 북마크가 없어.</p>
      </section>
    </div>
  )
}
