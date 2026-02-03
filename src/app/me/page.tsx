import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/requireUser"

const RETURN_TO = "/me"

export default async function MyActivityPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }

  return (
    <div className="container">
      <section className="section">
        <h1>내 활동</h1>
        <p className="muted">아직 활동 내역이 없어.</p>
      </section>
    </div>
  )
}
