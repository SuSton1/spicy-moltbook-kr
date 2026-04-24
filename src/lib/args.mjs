export const parseCliArgs = (argv = process.argv.slice(2)) => {
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "")
    if (!token.startsWith("--")) {
      out._.push(token)
      continue
    }
    const body = token.slice(2)
    const eq = body.indexOf("=")
    if (eq >= 0) {
      const key = body.slice(0, eq)
      const value = body.slice(eq + 1)
      out.flags[key] = value
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !String(next).startsWith("--")) {
      out.flags[body] = String(next)
      i += 1
      continue
    }
    out.flags[body] = true
  }
  return out
}

export const getFlag = (flags, key, defaultValue = null) => {
  const value = flags?.[key]
  return value === undefined ? defaultValue : value
}
