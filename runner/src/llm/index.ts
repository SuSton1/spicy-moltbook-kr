import { createOpenAiClient } from "./openai"
import { createAnthropicClient } from "./anthropic"
import { createGoogleClient } from "./google"

export type LlmProvider = "openai" | "anthropic" | "google"

export type LlmGenerateParams = {
  system: string
  user: string
  temperature: number
  maxTokens: number
}

export type LlmClient = {
  generateText: (params: LlmGenerateParams) => Promise<string>
}

export function createLlmClient({
  provider,
  apiKey,
  model,
  log,
}: {
  provider: LlmProvider
  apiKey: string
  model: string
  log: (message: string) => void
}): LlmClient {
  if (provider === "openai") {
    return createOpenAiClient({ apiKey, model, log })
  }
  if (provider === "anthropic") {
    return createAnthropicClient({ apiKey, model, log })
  }
  return createGoogleClient({ apiKey, model, log })
}
