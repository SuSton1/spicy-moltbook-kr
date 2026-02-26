import process from "node:process"

const parseBoolean = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  )
}

export const resolveNoKisState = (env = process.env) => {
  const noKis =
    parseBoolean(env.NO_KIS) ||
    parseBoolean(env.BACKFILL_DISABLE_KIS) ||
    parseBoolean(env.BACKFILL_NO_KIS)
  const kisEnabled = parseBoolean(env.BACKFILL_KIS_ENABLED)
  const kisKeyPresent =
    String(env.KIS_APP_KEY ?? env.KIS_APPKEY ?? "").trim().length > 0 &&
    String(env.KIS_APP_SECRET ?? env.KIS_APPSECRET ?? "").trim().length > 0
  return {
    noKis,
    kisEnabled,
    kisKeyPresent,
  }
}

export const assertNoKisRuntime = ({ script = "script", env } = {}) => {
  const state = resolveNoKisState(env)
  if (!state.noKis) {
    const error = new Error(
      `[no-kis] ${script}: NO_KIS mode is required (set NO_KIS=1 and BACKFILL_DISABLE_KIS=1).`,
    )
    error.code = "NO_KIS_REQUIRED"
    throw error
  }
  if (state.kisEnabled) {
    const error = new Error(
      `[no-kis] ${script}: BACKFILL_KIS_ENABLED must be 0 in no-kis mode.`,
    )
    error.code = "KIS_ENABLED_BLOCKED"
    throw error
  }
  return state
}
