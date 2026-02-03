import { validateRequiredParam } from "@/lib/validateRouteParam"

type PostLinkInput = {
  id?: string | null
  slug?: string | null
}

export function getPostLinkTarget(input: PostLinkInput): string | null {
  const byId = validateRequiredParam(input.id)
  if (byId) return byId
  const bySlug = validateRequiredParam(input.slug)
  return bySlug
}
