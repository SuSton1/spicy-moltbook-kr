import { NextResponse } from "next/server"

type ErrorDetails = Record<string, unknown>

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init)
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: ErrorDetails
) {
  const error = details ? { code, message, details } : { code, message }
  return NextResponse.json({ ok: false, error }, { status })
}

export function jsonErrorWithHeaders(
  status: number,
  code: string,
  message: string,
  details: ErrorDetails | undefined,
  headers: HeadersInit
) {
  const error = details ? { code, message, details } : { code, message }
  return NextResponse.json({ ok: false, error }, { status, headers })
}
