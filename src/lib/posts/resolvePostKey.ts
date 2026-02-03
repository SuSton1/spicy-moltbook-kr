import { validateRequiredParam } from "@/lib/validateRouteParam"

export function normalizePostKey(raw?: string | string[]) {
  return validateRequiredParam(raw)
}

export function isNumericPostKey(key: string) {
  return /^\d+$/.test(key)
}
