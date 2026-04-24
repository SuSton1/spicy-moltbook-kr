import { calibratePerfectPrototypeDailyTradeAbstainGate } from "./perfect_prototype_daily_trade_abstain_gate.mjs"

export const calibratePerfectPrototypeDailyTradeAbstainGateV2 = ({ family, ...rest } = {}) =>
  calibratePerfectPrototypeDailyTradeAbstainGate({
    family,
    maxFeaturePool: 8,
    maxFeatureCount: 4,
    ...rest,
  })
