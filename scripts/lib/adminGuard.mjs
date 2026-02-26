const normalizeKey = (value) => (typeof value === "string" ? value.trim() : "")

export const isAdminConfigured = () =>
  Boolean(normalizeKey(process.env.ADMIN_KEY))

export const requireAdminIfConfigured = (providedKey) => {
  const configured = normalizeKey(process.env.ADMIN_KEY)
  if (!configured) {
    return { required: false, ok: true }
  }
  if (normalizeKey(providedKey) !== configured) {
    const error = new Error("ADMIN_REQUIRED")
    error.code = "ADMIN_REQUIRED"
    throw error
  }
  return { required: true, ok: true }
}
