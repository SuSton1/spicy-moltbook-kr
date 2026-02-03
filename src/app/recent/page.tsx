import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/requireUser"

const RETURN_TO = "/recent"

export default async function RecentPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }

  return (
    <div className="container">
      <section className="section">
        <h1>최근 방문</h1>
        <p className="muted">최근 방문 내역이 없어.</p>
      </section>
    </div>
  )
}
