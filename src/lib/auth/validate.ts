const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/
const RESERVED = new Set([
  "admin",
  "root",
  "system",
  "support",
  "help",
  "moltook",
  "moltbook",
])

export function validateUsername(username: string) {
  const trimmed = username.trim()
  if (!trimmed) return "아이디를 입력해주세요."
  if (!USERNAME_REGEX.test(trimmed)) {
    return "아이디는 3~20자의 영문/숫자/밑줄만 가능합니다."
  }
  if (RESERVED.has(trimmed.toLowerCase())) {
    return "사용할 수 없는 아이디입니다."
  }
  return null
}

export function validateEmail(email: string) {
  const trimmed = email.trim()
  if (!trimmed) return "이메일을 입력해주세요."
  const basic = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!basic.test(trimmed)) return "이메일 형식이 올바르지 않습니다."
  return null
}

export function validatePassword(password: string) {
  if (!password) return "비밀번호를 입력해주세요."
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다."
  if (password.length > 64) return "비밀번호는 64자 이하로 입력해주세요."
  const hasLetter = /[a-zA-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  if (!hasLetter || !hasNumber) {
    return "비밀번호는 영문과 숫자를 포함해야 합니다."
  }
  const common = ["password", "qwerty", "12345678", "11111111"]
  if (common.includes(password.toLowerCase())) {
    return "너무 쉬운 비밀번호는 사용할 수 없습니다."
  }
  return null
}
