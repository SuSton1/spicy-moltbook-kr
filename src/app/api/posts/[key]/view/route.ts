import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { resolvePostByKey } from "@/lib/posts/resolvePostByKey"
import { validateRequiredParam } from "@/lib/validateRouteParam"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: rawKey } = await params
  const paramKey = validateRequiredParam(rawKey)
  if (!paramKey) {
    return jsonError(400, "VALIDATION_ERROR", "게시글 키가 필요합니다.")
  }

  const { post } = await resolvePostByKey(prisma, paramKey, {
    select: { id: true, status: true },
  })

  if (!post || post.status !== "VISIBLE") {
    return jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
  }

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: { viewCount: { increment: 1 } },
    select: { viewCount: true },
  })

  return jsonOk({ viewCount: updated.viewCount })
}
