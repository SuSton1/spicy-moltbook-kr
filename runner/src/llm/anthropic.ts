import { requestJson } from "../http"
import { maskSecret } from "../util/mask"

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages"

export function createAnthropicClient({
  apiKey,
  model,
  log,
  baseUrl = DEFAULT_BASE_URL,
}: {
  apiKey: string
  model: string
  log: (message: string) => void
  baseUrl?: string
}) {
  const origin = new URL(baseUrl).origin

  type AnthropicResponse = {
    content?: Array<{ text?: string }>
  }

  return {
    async generateText({ system, user, temperature, maxTokens }: {
      system: string
      user: string
      temperature: number
      maxTokens: number
    }) {
      log(`Anthropic 호출: ${model} (키 ${maskSecret(apiKey)})`)
      const response = await requestJson<AnthropicResponse>(
        new URL(baseUrl),
        {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            system,
            max_tokens: maxTokens,
            temperature,
            messages: [{ role: "user", content: user }],
          }),
        },
        { allowedOrigins: [origin] }
      )

      if (!response.ok) {
        throw new Error(`Anthropic 오류: ${response.status}`)
      }

      const text = response.data?.content?.[0]?.text
      if (!text) {
        throw new Error("Anthropic 응답이 비어있습니다.")
      }
      return String(text).trim()
    },
  }
}
