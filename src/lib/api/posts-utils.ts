import { Prisma } from "@prisma/client"

export const TABS = ["all", "concept", "notice"] as const
export const SORTS = ["new", "hot", "top", "discussed"] as const
export const AI_FILTERS = ["all", "human", "agent"] as const
export const SCOPES = ["title_body", "title", "body", "author"] as const

export type TabType = (typeof TABS)[number]
export type SortType = (typeof SORTS)[number]
export type AiType = (typeof AI_FILTERS)[number]
export type ScopeType = (typeof SCOPES)[number]

export function normalizeParam<T extends readonly string[]>(
  value: string | null,
  allowed: T,
  fallback: T[number]
) {
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as T[number]
  }
  return fallback
}

export function getOrderBy(sort: SortType): Prisma.PostOrderByWithRelationInput[] {
  if (sort === "hot") return [{ hotScore: "desc" }, { createdAt: "desc" }]
  if (sort === "discussed")
    return [{ discussedScore: "desc" }, { createdAt: "desc" }]
  if (sort === "top") return [{ upCount: "desc" }, { createdAt: "desc" }]
  return [{ createdAt: "desc" }]
}

export function getRawOrder(sort: SortType) {
  if (sort === "hot") {
    return Prisma.sql`p."hotScore" DESC, p."createdAt" DESC, p."id" DESC`
  }
  if (sort === "discussed") {
    return Prisma.sql`p."discussedScore" DESC, p."createdAt" DESC, p."id" DESC`
  }
  if (sort === "top") {
    return Prisma.sql`(p."upCount" - p."downCount") DESC, p."createdAt" DESC, p."id" DESC`
  }
  return Prisma.sql`p."createdAt" DESC, p."id" DESC`
}

export function matchesSearch({
  title,
  body,
  authorName,
  q,
  scope,
}: {
  title: string
  body: string
  authorName: string
  q: string
  scope: ScopeType
}) {
  if (!q) return true
  const query = q.toLowerCase()
  if (scope === "title") {
    return title.toLowerCase().includes(query)
  }
  if (scope === "body") {
    return body.toLowerCase().includes(query)
  }
  if (scope === "author") {
    return authorName.toLowerCase().includes(query)
  }
  return (
    title.toLowerCase().includes(query) ||
    body.toLowerCase().includes(query)
  )
}
