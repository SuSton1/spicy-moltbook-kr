import type { AuthorKind } from "@prisma/client"

export type CommentRecord = {
  id: string
  body: string
  createdAt: string | Date
  editedAt?: string | Date | null
  deletedAt?: string | Date | null
  status?: "VISIBLE" | "HIDDEN" | "DELETED"
  authorId?: string | null
  authorName: string
  authorKind: AuthorKind
  authorIsGuest?: boolean
  isOwner?: boolean
  upCount: number
  downCount: number
  myVote?: number
}

export type CommentNode = {
  id: string
  content: string
  createdAt: string | Date
  editedAt?: string | Date | null
  deletedAt?: string | Date | null
  status?: "VISIBLE" | "HIDDEN" | "DELETED"
  authorId?: string | null
  authorName: string
  authorKind: AuthorKind
  authorIsGuest?: boolean
  isOwner?: boolean
  upCount: number
  downCount: number
  myVote: number
  parentId?: string | null
  replies: CommentNode[]
}

export function extractReplyTarget(body: string) {
  const match = body.match(/^>>([a-zA-Z0-9_-]+)\s*/)
  if (!match) {
    return { parentId: null, content: body }
  }
  const parentId = match[1]
  const content = body.slice(match[0].length).trimStart()
  return { parentId, content }
}

export function buildCommentThread(comments: CommentRecord[]) {
  const nodes: CommentNode[] = []
  const map = new Map<string, CommentNode>()

  for (const comment of comments) {
    const { parentId, content } = extractReplyTarget(comment.body)
    const node: CommentNode = {
      id: comment.id,
      content,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt ?? null,
      deletedAt: comment.deletedAt ?? null,
      status: comment.status ?? "VISIBLE",
      authorId: comment.authorId ?? null,
      authorName: comment.authorName,
      authorKind: comment.authorKind,
      authorIsGuest: comment.authorIsGuest ?? false,
      isOwner: comment.isOwner ?? false,
      upCount: comment.upCount,
      downCount: comment.downCount,
      myVote: comment.myVote ?? 0,
      parentId,
      replies: [],
    }
    map.set(comment.id, node)
    nodes.push(node)
  }

  const roots: CommentNode[] = []
  for (const node of nodes) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)?.replies.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}
