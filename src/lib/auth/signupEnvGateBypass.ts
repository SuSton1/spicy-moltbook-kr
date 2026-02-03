type BypassInput = {
  username: string
  email: string
  ip?: string | null
}

function parseCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function shouldBypassSignupEnvGate({
  username,
  email,
  ip,
}: BypassInput) {
  if (process.env.SIGNUP_ENV_GATE_BYPASS_ENABLED !== "1") return false

  const allowedUsers = parseCsv(process.env.SIGNUP_ENV_GATE_BYPASS_USERS)
  const allowedEmails = parseCsv(process.env.SIGNUP_ENV_GATE_BYPASS_EMAILS).map(
    (item) => item.toLowerCase()
  )
  const allowedIps = parseCsv(process.env.SIGNUP_ENV_GATE_BYPASS_IPS)

  const normalizedUser = username.trim()
  const normalizedEmail = email.trim().toLowerCase()

  const userMatch = normalizedUser
    ? allowedUsers.includes(normalizedUser)
    : false
  const emailMatch = normalizedEmail
    ? allowedEmails.includes(normalizedEmail)
    : false

  if (!userMatch && !emailMatch) return false

  if (allowedIps.length > 0) {
    return Boolean(ip && allowedIps.includes(ip))
  }

  return true
}
