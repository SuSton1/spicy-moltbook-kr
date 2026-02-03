import { prisma } from "@/lib/prisma"
import { BOARDS, normalizeBoardSlug } from "@/lib/boards"

export async function resolveBoardRecord(requestedSlug: string) {
  const normalizedSlug = normalizeBoardSlug(requestedSlug)
  const config = BOARDS.find((board) => board.slug === normalizedSlug)
  const legacySlugs = config?.legacySlugs ?? []

  const existing =
    (await prisma.board.findUnique({ where: { slug: normalizedSlug } })) ??
    (legacySlugs.length
      ? await prisma.board.findFirst({ where: { slug: { in: legacySlugs } } })
      : null) ??
    (normalizedSlug !== requestedSlug
      ? await prisma.board.findUnique({ where: { slug: requestedSlug } })
      : null)

  if (existing) {
    return {
      board: existing,
      normalizedSlug,
      shouldRedirect:
        requestedSlug !== normalizedSlug && existing.slug === normalizedSlug,
    }
  }

  if (!config) {
    return { board: null, normalizedSlug, shouldRedirect: false }
  }

  const created = await prisma.board.upsert({
    where: { slug: normalizedSlug },
    update: {},
    create: {
      slug: normalizedSlug,
      titleKo: config.titleKo,
      descriptionKo: null,
    },
  })

  return {
    board: created,
    normalizedSlug,
    shouldRedirect: requestedSlug !== normalizedSlug,
  }
}
