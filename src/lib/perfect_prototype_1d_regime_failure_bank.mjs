import {
  buildPerfectPrototypeOverlayFailureBank,
  matchesPerfectPrototypeOverlayFailureRule,
} from "./perfect_prototype_overlay_failure_bank.mjs"

export const matchesPerfectPrototype1dRegimeFailureRule = matchesPerfectPrototypeOverlayFailureRule

export const buildPerfectPrototype1dRegimeFailureBank = ({
  cellDataset,
  maxSeedTokens = 18,
  maxRuleTokens = 3,
  maxQualifiedRules = 8,
} = {}) =>
  buildPerfectPrototypeOverlayFailureBank({
    dataset: cellDataset,
    maxSeedTokens,
    maxRuleTokens,
    maxQualifiedRules,
  })
