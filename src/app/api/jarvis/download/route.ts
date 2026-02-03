import { jsonError, jsonOk } from "@/lib/api/response"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const os = url.searchParams.get("os")

  if (os !== "windows" && os !== "mac") {
    return jsonError(400, "INVALID_OS", "지원하지 않는 OS입니다.")
  }

  const downloadUrl =
    os === "windows"
      ? process.env.JARVIS_WINDOWS_DOWNLOAD_URL
      : process.env.JARVIS_MAC_DOWNLOAD_URL

  if (!downloadUrl) {
    return jsonError(404, "NOT_READY", "다운로드 준비 중입니다.")
  }

  return jsonOk({ url: downloadUrl })
}
