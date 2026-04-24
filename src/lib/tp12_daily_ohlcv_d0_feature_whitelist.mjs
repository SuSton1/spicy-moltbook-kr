export const TP12_DAILY_OHLCV_D0_TOKENIZER_VERSION = "tp12_daily_ohlcv_d0_tokenizer_v1"

export const TP12_DAILY_OHLCV_D0_FORBIDDEN_TOKEN_FAMILIES = [
  ["f", "low"].join(""),
  "program",
  "intraday",
  "news",
  "theme",
  "sector",
  "liq",
  "cap",
]

export const TP12_DAILY_OHLCV_D0_TOKEN_VOCABULARY = [
  "shape:range_ge_0p04",
  "shape:range_ge_0p07",
  "shape:body_ge_0p45",
  "shape:body_ge_0p65",
  "shape:body_le_0p20",
  "shape:upper_wick_ge_0p35",
  "shape:upper_wick_ge_0p55",
  "shape:lower_wick_ge_0p35",
  "shape:lower_wick_ge_0p55",
  "shape:close_pos_ge_0p65",
  "shape:close_pos_ge_0p80",
  "shape:close_pos_ge_0p90",
  "shape:close_pos_le_0p35",
  "shape:close_pos_le_0p20",
  "shape:bull_body_ge_0p45",
  "shape:bear_body_ge_0p45",
  "vol:rel5_ge_1p5",
  "vol:rel5_ge_2p5",
  "vol:rel20_ge_1p5",
  "vol:rel20_ge_2p5",
  "vol:rel20_ge_4",
  "vol:rel20_le_0p5",
  "vol:rel60_ge_1p5",
  "vol:rel60_ge_2p5",
  "vol:rel60_le_0p5",
  "vol:rel120_ge_1p5",
  "vol:rel120_le_0p5",
  "vol:ma5_gt_ma20",
  "vol:ma20_gt_ma60",
  "vol:ma60_gt_ma120",
  "vol:ma5_gt_ma20_gt_ma60_gt_ma120",
  "vol:ma5_lt_ma20_lt_ma60_lt_ma120",
  "vol:compress5_20_le_0p7",
  "vol:reexpand_after_compress",
  "amt:rel20_ge_1p5",
  "amt:rel20_ge_3",
  "amt:rel20_le_0p5",
  "amt:rel60_ge_1p5",
  "amt:rel120_ge_1p5",
  "amt:ma5_gt_ma20",
  "amt:ma20_gt_ma60",
  "amt:ma5_gt_ma20_gt_ma60",
  "amt:compress5_20_le_0p7",
  "amt:reexpand_after_compress",
  "pxma:close_gt_ma5",
  "pxma:close_gt_ma20",
  "pxma:close_gt_ma60",
  "pxma:close_gt_ma120",
  "pxma:close_over_ma20_ge_0p05",
  "pxma:close_over_ma20_ge_0p10",
  "pxma:close_over_ma60_ge_0p05",
  "pxma:close_over_ma60_ge_0p15",
  "pxma:close_under_ma20_le_m0p05",
  "pxma:close_under_ma60_le_m0p10",
  "pxma:ma5_gt_ma20",
  "pxma:ma20_gt_ma60",
  "pxma:ma60_gt_ma120",
  "pxma:ma5_gt_ma20_gt_ma60_gt_ma120",
  "level:close_break_high20",
  "level:close_break_high60",
  "level:high_break_high20",
  "recover:close_reclaim_ma20",
  "recover:close_reclaim_ma60",
]

export const assertDailyOhlcvD0TokenVocabulary = () => {
  const unique = new Set(TP12_DAILY_OHLCV_D0_TOKEN_VOCABULARY)
  if (unique.size !== TP12_DAILY_OHLCV_D0_TOKEN_VOCABULARY.length) {
    throw new Error("daily OHLCV D0 token vocabulary contains duplicate tokens")
  }
  if (unique.size > 63) {
    throw new Error(`daily OHLCV D0 token vocabulary exceeds uint64 mask capacity: ${unique.size}`)
  }
  for (const token of unique) {
    const family = token.split(":")[0] || ""
    if (TP12_DAILY_OHLCV_D0_FORBIDDEN_TOKEN_FAMILIES.includes(family)) {
      throw new Error(`daily OHLCV D0 token vocabulary contains forbidden family: ${token}`)
    }
  }
}
