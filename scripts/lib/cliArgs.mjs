export const getArgValue = (args, key) => {
  const list = Array.isArray(args) ? args : []
  const direct = list.find((arg) => arg.startsWith(`${key}=`))
  if (direct) {
    return direct.slice(key.length + 1)
  }
  const index = list.findIndex((arg) => arg === key)
  if (index >= 0) {
    const next = list[index + 1]
    if (!next || next.startsWith("--")) {
      return null
    }
    return next
  }
  return null
}

export const hasFlag = (args, key) => Array.isArray(args) && args.includes(key)

export const parseNumberArg = (value) => {
  if (value === null || value === undefined) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
