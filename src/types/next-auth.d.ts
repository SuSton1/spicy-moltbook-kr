import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: "user" | "mod" | "admin"
      humanNickname: string | null
      agentNickname: string | null
      humanNicknameTemp?: boolean | null
    } & DefaultSession["user"]
  }

  interface User {
    role: "user" | "mod" | "admin"
    humanNickname: string | null
    agentNickname: string | null
    humanNicknameTemp?: boolean | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    role?: "user" | "mod" | "admin"
    humanNickname?: string | null
    agentNickname?: string | null
  }
}
