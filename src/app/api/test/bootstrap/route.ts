import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { BOARDS } from "@/lib/boards"
import { getOrCreateActorForAgent, getOrCreateActorForUser } from "@/lib/actors"
import { hashPassword } from "@/lib/auth/password"
import { normalizeNickname } from "@/lib/nicknameNormalize"

export async function GET(request: Request) {
  if (process.env.E2E_TEST !== "1") {
    return new NextResponse("Not Found", { status: 404 })
  }

  const url = new URL(request.url)
  const shouldLogin = url.searchParams.get("login") === "1"
  const uid = url.searchParams.get("uid")?.trim() || "default"
  const withAgent = url.searchParams.get("agent") === "1"

  const boardConfigs =
    BOARDS.length > 0
      ? BOARDS
      : [{ slug: "singularity", titleKo: "특이점이온다", key: "singularity", href: "/b/singularity" }]
  let board = null as { id: string; slug: string; titleKo: string } | null
  for (const config of boardConfigs) {
    const created = await prisma.board.upsert({
      where: { slug: config.slug },
      update: { titleKo: config.titleKo },
      create: { slug: config.slug, titleKo: config.titleKo },
    })
    if (!board) {
      board = created
    }
  }
  if (!board) {
    board = await prisma.board.create({
      data: { slug: "singularity", titleKo: "특이점이온다" },
    })
  }

  const now = new Date()
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "default"
  const email = `e2e+${safeUid}@moltook.test`
  const nicknameSuffix = safeUid.slice(0, 8)
  const humanNickname = `E2E${nicknameSuffix}`
  const humanNormalized = normalizeNickname(humanNickname)
  const agentNickname = withAgent ? `AG${nicknameSuffix}` : null
  const agentNormalized = agentNickname ? normalizeNickname(agentNickname) : null
  const username = `e2e_user_${safeUid}`.slice(0, 20)
  const rawPassword = `E2Epass1`
  const passwordHash = await hashPassword(rawPassword)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      humanNickname,
      agentNickname,
      adultConfirmedAt: now,
      termsVersionAccepted: "1.0",
      privacyVersionAccepted: "1.0",
      username,
      passwordHash,
      emailVerified: now,
    },
    create: {
      email,
      humanNickname,
      agentNickname,
      adultConfirmedAt: now,
      termsVersionAccepted: "1.0",
      privacyVersionAccepted: "1.0",
      username,
      passwordHash,
      emailVerified: now,
    },
  })

  const actor = await getOrCreateActorForUser(prisma, user.id)

  await prisma.nicknameRegistry.upsert({
    where: { userId_kind: { userId: user.id, kind: "HUMAN" } },
    update: {
      nickname: humanNickname,
      normalizedNickname: humanNormalized,
    },
    create: {
      userId: user.id,
      kind: "HUMAN",
      nickname: humanNickname,
      normalizedNickname: humanNormalized,
    },
  })

  if (agentNickname && agentNormalized) {
    await prisma.nicknameRegistry.upsert({
      where: { userId_kind: { userId: user.id, kind: "AGENT" } },
      update: {
        nickname: agentNickname,
        normalizedNickname: agentNormalized,
      },
      create: {
        userId: user.id,
        kind: "AGENT",
        nickname: agentNickname,
        normalizedNickname: agentNormalized,
      },
    })
  }

  const postTitle = `[E2E] ${safeUid} 테스트 글`
  const postBody = "E2E 본문 내용입니다."
  const post =
    (await prisma.post.findFirst({
      where: { title: postTitle, boardId: board.id },
    })) ??
    (await prisma.post.create({
      data: {
        boardId: board.id,
        authorActorId: actor.id,
        title: postTitle,
        body: postBody,
        status: "VISIBLE",
        authorKind: "HUMAN",
        pinned: true,
      },
    }))

  if (agentNickname) {
    const agent = await prisma.agent.upsert({
      where: { ownerUserId: user.id },
      update: { displayNameKo: agentNickname },
      create: {
        ownerUserId: user.id,
        displayNameKo: agentNickname,
        status: "ACTIVE",
      },
    })
    const agentActor = await getOrCreateActorForAgent(prisma, agent.id)
    const agentCommentBody = `[E2E] ${safeUid} 에이전트 댓글`
    const existingAgentComment = await prisma.comment.findFirst({
      where: { postId: post.id, body: agentCommentBody },
    })
    if (!existingAgentComment) {
      await prisma.comment.create({
        data: {
          postId: post.id,
          authorActorId: agentActor.id,
          authorKind: "AGENT",
          body: agentCommentBody,
          status: "VISIBLE",
        },
      })
    }
  }

  const response = NextResponse.json({
    ok: true,
    postId: post.id,
    postTitle: post.title,
    username: shouldLogin ? username : undefined,
    password: shouldLogin ? rawPassword : undefined,
  })

  return response
}
