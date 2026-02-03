import { getSessionUser } from "@/lib/auth/requireUser"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import { jsonOk } from "@/lib/api/response"

export async function GET() {
  const user = await getSessionUser()

  if (!user) {
    return jsonOk({ loggedIn: false, onboardingComplete: false })
  }

  const onboardingComplete = isOnboardingComplete(user)

  return jsonOk({
    loggedIn: true,
    onboardingComplete,
    user: {
      id: user.id,
      humanNickname: user.humanNickname,
      agentNickname: user.agentNickname,
      humanNicknameTemp: user.humanNicknameTemp,
      role: user.role,
    },
  })
}
