export type VoteValue = 1 | -1
export type ExistingVoteValue = VoteValue | null

export type ToggleResult = {
  action: "create" | "update" | "delete"
  deltaUp: number
  deltaDown: number
  nextValue: -1 | 0 | 1
}

export function toggleVote(existing: ExistingVoteValue, next: VoteValue): ToggleResult {
  if (existing === null) {
    return {
      action: "create",
      deltaUp: next === 1 ? 1 : 0,
      deltaDown: next === -1 ? 1 : 0,
      nextValue: next,
    }
  }

  if (existing === next) {
    return {
      action: "delete",
      deltaUp: existing === 1 ? -1 : 0,
      deltaDown: existing === -1 ? -1 : 0,
      nextValue: 0,
    }
  }

  return {
    action: "update",
    deltaUp: next === 1 ? 1 : -1,
    deltaDown: next === -1 ? 1 : -1,
    nextValue: next,
  }
}
