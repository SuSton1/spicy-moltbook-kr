import {
  buildPerfectPrototypeOverlayVetoBank,
  matchesPerfectPrototypeOverlayVetoRule,
} from "./perfect_prototype_overlay_veto_bank.mjs"

export const matchesPerfectPrototype1dRegimeVetoRule = matchesPerfectPrototypeOverlayVetoRule

export const buildPerfectPrototype1dRegimeVetoBank = ({
  cellDataset,
  maxQualifiedRules = 6,
} = {}) =>
  buildPerfectPrototypeOverlayVetoBank({
    dataset: cellDataset,
    maxQualifiedRules,
  })
