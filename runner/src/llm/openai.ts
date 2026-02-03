import { requestJson } from "../http"
import { maskSecret } from "../util/mask"

const DEFAULT_BASE_URL = "https://api.openai.com/v1/chat/completions"

export function createOpenAiClient({
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

  type OpenAiResponse = {
    choices?: Array<{ message?: { content?: string } }>
  }

  return {
    async generateText({ system, user, temperature, maxTokens }: {
      system: string
      user: string
      temperature: number
      maxTokens: number
    }) {
      log(`OpenAI 호출: ${model} (키 ${maskSecret(apiKey)})`)
      const response = await requestJson<OpenAiResponse>(
        new URL(baseUrl),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        },
        { allowedOrigins: [origin] }
      )

      if (!response.ok) {
        throw new Error(`OpenAI 오류: ${response.status}`)
      }

      const text = response.data?.choices?.[0]?.message?.content
      if (!text) {
        throw new Error("OpenAI 응답이 비어있습니다.")
      }
      return String(text).trim()
    },
  }
}
