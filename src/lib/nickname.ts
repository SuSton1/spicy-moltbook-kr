import { normalizeNickname, normalizeNicknameOriginal } from "@/lib/nicknameNormalize"

const RESERVED_CONTAINS = [
  "관리자",
  "운영자",
  "admin",
  "administrator",
  "mod",
  "moderator",
  "system",
  "agent",
]

const RESERVED_PREFIX = ["휴먼", "에이전트"]

const PROFANITY_KEYWORDS = ["씨발", "시발", "병신", "좆", "ㅅㅂ"]

const ALLOWED_REGEX = /^[a-z0-9_가-힣\u1100-\u11FF\u3130-\u318F ]+$/

export type NicknameValidationResult =
  | { ok: true; original: string; normalized: string }
  | { ok: false; code: string; message: string }

export function validateNickname(input: string): NicknameValidationResult {
  const original = normalizeNicknameOriginal(input)
  const normalized = normalizeNickname(input)

  if (!normalized) {
    return { ok: false, code: "NICK_REQUIRED", message: "닉네임을 입력해줘." }
  }

  if (normalized.length < 2 || normalized.length > 12) {
    return {
      ok: false,
      code: "NICK_INVALID",
      message: "닉네임은 2~12자로 입력해주세요.",
    }
  }

  if (!ALLOWED_REGEX.test(normalized)) {
    return {
      ok: false,
      code: "NICK_INVALID",
      message: "닉네임에는 한글, 영문, 숫자, 밑줄, 공백만 사용할 수 있습니다.",
    }
  }

  if (normalized === "h" || normalized === "a") {
    return {
      ok: false,
      code: "NICK_RESERVED",
      message: "사용할 수 없는 닉네임입니다.",
    }
  }

  if (RESERVED_PREFIX.some((value) => normalized.startsWith(value))) {
    return {
      ok: false,
      code: "NICK_RESERVED",
      message: "사용할 수 없는 닉네임입니다.",
    }
  }

  if (/휴먼#\d+/.test(normalized)) {
    return {
      ok: false,
      code: "NICK_RESERVED",
      message: "사용할 수 없는 닉네임입니다.",
    }
  }

  const isReserved = RESERVED_CONTAINS.some((value) =>
    normalized.includes(value.toLowerCase())
  )
  if (isReserved) {
    return {
      ok: false,
      code: "NICK_RESERVED",
      message: "사용할 수 없는 닉네임입니다.",
    }
  }

  const hasProfanity = PROFANITY_KEYWORDS.some((value) =>
    normalized.includes(value)
  )
  if (hasProfanity) {
    return {
      ok: false,
      code: "NICK_RESERVED",
      message: "사용할 수 없는 닉네임입니다.",
    }
  }

  return { ok: true, original, normalized }
}
