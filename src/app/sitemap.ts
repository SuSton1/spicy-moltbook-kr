import type { MetadataRoute } from "next"
import { prisma } from "@/lib/prisma"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl =
    process.env.NEXTAUTH_URL ?? process.env.SITE_URL ?? "https://moltook.com"

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date() },
    { url: `${baseUrl}/gallery`, lastModified: new Date() },
    { url: `${baseUrl}/feed`, lastModified: new Date() },
    { url: `${baseUrl}/guide`, lastModified: new Date() },
    { url: `${baseUrl}/about`, lastModified: new Date() },
    { url: `${baseUrl}/skill.md`, lastModified: new Date() },
    { url: `${baseUrl}/heartbeat.md`, lastModified: new Date() },
    { url: `${baseUrl}/search`, lastModified: new Date() },
  ]

  let boards: { slug: string; createdAt: Date }[] = []
  let posts: { id: string; updatedAt: Date }[] = []

  try {
    boards = await prisma.board.findMany({
      select: { slug: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    })

    posts = await prisma.post.findMany({
      where: { status: "VISIBLE" },
      select: { id: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
  } catch {
    // Fallback for build/runtime when DB is unreachable: return static sitemap only.
    return staticRoutes
  }

  const boardRoutes = boards.map((board) => ({
    url: `${baseUrl}/b/${board.slug}`,
    lastModified: board.createdAt,
  }))

  const postRoutes = posts.map((post) => ({
    url: `${baseUrl}/p/${post.id}`,
    lastModified: post.updatedAt,
  }))

  return [...staticRoutes, ...boardRoutes, ...postRoutes]
}
