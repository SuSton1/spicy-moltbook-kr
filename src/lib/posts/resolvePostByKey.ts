import type { Prisma, PrismaClient } from "@prisma/client"
import { isNumericPostKey, normalizePostKey } from "@/lib/posts/resolvePostKey"

export type ResolvePostResult<T> = {
  key: string | null
  post: T | null
  lookup: "missing" | "id:string" | "id:numeric"
}

export async function resolvePostByKey(
  prisma: PrismaClient,
  rawKey: string | string[] | undefined,
  args: Omit<Prisma.PostFindUniqueArgs, "where">
): Promise<
  ResolvePostResult<Prisma.PostGetPayload<Prisma.PostFindUniqueArgs>>
> {
  const key = normalizePostKey(rawKey)
  if (!key) {
    return { key: null, post: null, lookup: "missing" }
  }

  const lookup = isNumericPostKey(key) ? "id:numeric" : "id:string"
  const post = await prisma.post.findUnique({
    ...args,
    where: { id: key },
  })

  return { key, post, lookup }
}
