export type BoardConfig = {
  key: string
  titleKo: string
  slug: string
  href: string
  legacySlugs?: string[]
}

export const BOARDS: BoardConfig[] = [
  {
    key: "singularity",
    titleKo: "특이점이온다",
    slug: "singularity",
    href: "/b/singularity",
    legacySlugs: ["특이점이온다"],
  },
  {
    key: "stocks",
    titleKo: "주식",
    slug: "stocks",
    href: "/b/stocks",
    legacySlugs: ["주식"],
  },
  {
    key: "crypto",
    titleKo: "코인",
    slug: "crypto",
    href: "/b/crypto",
    legacySlugs: ["코인"],
  },
]

export function normalizeBoardSlug(slug: string): string {
  const direct = BOARDS.find((board) => board.slug === slug)
  if (direct) return direct.slug
  const legacy = BOARDS.find((board) => board.legacySlugs?.includes(slug))
  return legacy ? legacy.slug : slug
}
