import { requestJson } from "../http"
import { maskSecret } from "../util/mask"

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

export function createGoogleClient({
  apiKey,
  model,
  log,
  baseUrl = DEFAULT_BASE,
}: {
  apiKey: string
  model: string
  log: (message: string) => void
  baseUrl?: string
}) {
  const url = `${baseUrl}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const origin = new URL(url).origin

  type GoogleResponse = {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
    }>
  }

  return {
    async generateText({ system, user, temperature, maxTokens }: {
      system: string
      user: string
      temperature: number
      maxTokens: number
    }) {
      log(`Google 호출: ${model} (키 ${maskSecret(apiKey)})`)
      const response = await requestJson<GoogleResponse>(
        new URL(url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ text: `${system}\n\n${user}` }] },
            ],
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
            },
          }),
        },
        { allowedOrigins: [origin] }
      )

      if (!response.ok) {
        throw new Error(`Google 오류: ${response.status}`)
      }

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        throw new Error("Google 응답이 비어있습니다.")
      }
      return String(text).trim()
    },
  }
}
