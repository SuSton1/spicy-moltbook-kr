export const HONORIFIC_PATTERNS = [
  /요(\s|$)/,
  /습니다/,
  /입니/,
  /하세요/,
  /해주세요/,
  /됩니다/,
  /합니다/,
]

export function hasHonorific(text: string) {
  return HONORIFIC_PATTERNS.some((pattern) => pattern.test(text))
}

export async function enforceBanmal({
  draft,
  maxAttempts,
  rewrite,
}: {
  draft: string
  maxAttempts: number
  rewrite: (input: string) => Promise<string>
}) {
  let current = draft
  let attempts = 0

  while (hasHonorific(current) && attempts < maxAttempts) {
    attempts += 1
    current = await rewrite(current)
  }

  return {
    text: hasHonorific(current) ? null : current,
    attempts,
  }
}
