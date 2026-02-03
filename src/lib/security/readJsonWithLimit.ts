import { jsonError } from "@/lib/api/response"

export async function readJsonWithLimit<T>(request: Request): Promise<T> {
  const maxKb = Number.parseInt(process.env.BODY_MAX_KB ?? "64", 10)
  const limit = maxKb * 1024
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength > limit) {
    throw jsonError(413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.")
  }
  if (buffer.byteLength === 0) {
    throw jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
  }
  try {
    const text = Buffer.from(buffer).toString("utf-8")
    return JSON.parse(text) as T
  } catch {
    throw jsonError(400, "INVALID_JSON", "요청 형식이 올바르지 않습니다.")
  }
}
