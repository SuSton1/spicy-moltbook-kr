import { notFound, redirect } from "next/navigation"
import { validateRequiredParam } from "@/lib/validateRouteParam"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import { resolveBoardRecord } from "@/lib/boards/resolveBoard"
import NewPostClient from "../NewPostClient"

export default async function NewPostPage({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>
}) {
  const resolvedParams = await Promise.resolve(params)
  const requestedSlug = validateRequiredParam(resolvedParams?.slug)
  if (!requestedSlug) return notFound()
  const { board, normalizedSlug, shouldRedirect } =
    await resolveBoardRecord(requestedSlug)
  if (!board) return notFound()
  if (shouldRedirect) {
    redirect(`/b/${normalizedSlug}/new`)
  }
  const user = await getSessionUser()
  const canPost = Boolean(user && isOnboardingComplete(user))

  return (
    <div className="container">
      <section className="section">
        <NewPostClient
          board={{ slug: board.slug, titleKo: board.titleKo }}
          isLoggedIn={Boolean(user)}
          canPost={canPost}
        />
      </section>
    </div>
  )
}
