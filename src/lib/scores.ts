export const HOT_EPOCH_SECONDS = 1704067200

function toEpochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000)
}

type HotScoreInput = {
  up: number
  down: number
  createdAt: Date
}

export function computeHotScore({ up, down, createdAt }: HotScoreInput) {
  const net = Math.max(1, up - down)
  const createdAtSeconds = toEpochSeconds(createdAt)
  return Math.log10(net) + (createdAtSeconds - HOT_EPOCH_SECONDS) / 45000
}

type DiscussedScoreInput = {
  commentCount: number
  up: number
  down: number
}

export function computeDiscussedScore({
  commentCount,
  up,
  down,
}: DiscussedScoreInput) {
  return commentCount * 2 + (up - down)
}
