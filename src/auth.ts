import NextAuth from "next-auth"
import type { User as AuthUser } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { authorizeCredentials } from "@/lib/security/authorizeCredentials"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import {
  checkAuthLock,
  clearAuthLock,
  recordAuthFailure,
} from "@/lib/security/authLock"
import { logSecurityEvent } from "@/lib/security/audit"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "아이디", type: "text" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials, request) {
        const username =
          typeof credentials?.username === "string"
            ? credentials.username.trim()
            : ""
        const password =
          typeof credentials?.password === "string" ? credentials.password : ""
        if (!username || !password) return null

        const req = request as Request | undefined
        const { ip } = req ? getClientIp(req) : { ip: "" }
        if (!ip && process.env.NODE_ENV === "production") {
          return null
        }
        const ipKey = hashIpValue(ip || "unknown")
        const ipLimit = Number.parseInt(
          process.env.RL_LOGIN_PER_IP_PER_MIN ?? "10",
          10
        )
        const userLimit = Number.parseInt(
          process.env.RL_LOGIN_PER_USER_PER_HOUR ?? "20",
          10
        )

        const rlIp = await checkRateLimit({
          key: `login:ip:${ipKey}`,
          limit: Number.isFinite(ipLimit) ? ipLimit : 10,
          windowSec: 60,
          ip,
        })
        if (!rlIp.ok) {
          await logSecurityEvent("LOGIN_RATE_LIMIT", { ip })
          return null
        }

        const rlUser = await checkRateLimit({
          key: `login:user:${username}`,
          limit: Number.isFinite(userLimit) ? userLimit : 20,
          windowSec: 60 * 60,
          ip,
        })
        if (!rlUser.ok) {
          await logSecurityEvent("LOGIN_RATE_LIMIT", { ip, meta: { username } })
          return null
        }

        const lock = await checkAuthLock(`login:${username}`)
        if (lock.locked) {
          await logSecurityEvent("LOGIN_LOCKED", { ip, meta: { username } })
          return null
        }

        const user = await authorizeCredentials({ username, password })
        if (!user) {
          await recordAuthFailure(`login:${username}`)
          await logSecurityEvent("LOGIN_FAIL", { ip, meta: { username } })
          return null
        }

        await clearAuthLock(`login:${username}`)

        const authUser: AuthUser = {
          id: user.id,
          email: user.email,
          name: user.humanNickname ?? user.name ?? null,
          humanNickname: user.humanNickname,
          agentNickname: user.agentNickname,
          role: user.role,
        }
        return authUser
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.humanNickname = user.humanNickname
        token.agentNickname = user.agentNickname
        token.email = user.email
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        if (typeof token.id === "string") {
          session.user.id = token.id
        }
        if (token.role) {
          session.user.role = token.role as "user" | "mod" | "admin"
        }
        session.user.humanNickname =
          typeof token.humanNickname === "string" ? token.humanNickname : null
        session.user.agentNickname =
          typeof token.agentNickname === "string" ? token.agentNickname : null
      }
      return session
    },
  },
})
