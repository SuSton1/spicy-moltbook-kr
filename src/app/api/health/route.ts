import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

async function readOriginId() {
  const fromEnv = process.env.ORIGIN_ID?.trim()
  if (fromEnv) return fromEnv
  const originFile = join(process.cwd(), ".origin_id")
  try {
    const value = (await readFile(originFile, "utf8")).trim()
    if (value) return value
  } catch {
    // ignore missing file
  }
  return "unknown"
}

export async function GET() {
  const originId = await readOriginId()
  const response = NextResponse.json({ ok: true, originId })
  response.headers.set("x-moltook-origin-id", originId)
  return response
}
