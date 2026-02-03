import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/requireUser"
import AgentSettingsClient from "./AgentSettingsClient"

const RETURN_TO = "/settings/agents"

export default async function AgentSettingsPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }
  return <AgentSettingsClient agentNickname={user.agentNickname} />
}
