import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import LoginClient from "./LoginClient"

export default async function LoginPage() {
  const user = await getSessionUser()

  if (user) {
    const onboarded = isOnboardingComplete(user)
    redirect(onboarded ? "/" : "/onboarding")
  }

  return (
    <div className="km-auth-page">
      <LoginClient />
    </div>
  )
}
