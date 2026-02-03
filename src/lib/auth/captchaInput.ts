export function sanitizeCaptchaInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 6)
}

export function resolveCaptchaValue(domValue: string | null, stateValue: string) {
  const fromDom = sanitizeCaptchaInput(domValue ?? "")
  if (fromDom.length > 0) return fromDom
  return sanitizeCaptchaInput(stateValue)
}
