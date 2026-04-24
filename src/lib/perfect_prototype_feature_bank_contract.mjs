import crypto from "node:crypto"

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

export const buildPerfectPrototypeDailyMechanismHypothesisCatalog = () => [
  {
    hypothesisId: "H1",
    name: "pathGeom_sponsor",
    featurePrefixes: ["sig.pathGeom.", "sig.sponsor."],
    description: "Path geometry plus sponsorship coupling",
  },
  {
    hypothesisId: "H2",
    name: "stateTrans_phaseDiv",
    featurePrefixes: ["sig.stateTrans.", "sig.phaseDiv."],
    description: "Compression-to-expansion transitions plus cross-horizon phase divergence",
  },
  {
    hypothesisId: "H3",
    name: "slateJoint_liqPath",
    featurePrefixes: ["sig.slateJoint.", "sig.liqPath."],
    description: "Same-date joint rarity plus liquidity stability path",
  },
]

export const buildPerfectPrototypeDailySymbolicMicrocardHypothesisCatalog = () => [
  {
    hypothesisId: "H1",
    name: "dayGlyph_kgram_auctionControl",
    featurePrefixes: [
      "sig.microCard.dayGlyph.",
      "sig.microCard.kgram.",
      "sig.auctionControl.pattern.",
    ],
    description: "Daily glyph plus short symbolic path plus close-control pattern",
  },
  {
    hypothesisId: "H2",
    name: "phaseGrammar_sponsorCoupling_anchorPath",
    featurePrefixes: [
      "sig.phaseGrammar.transition.",
      "sig.sponsorCoupling.pattern.",
      "sig.anchorPath.extrema.",
    ],
    description: "Phase transitions plus sponsorship coupling plus anchor-path states",
  },
  {
    hypothesisId: "H3",
    name: "slateSymbolicContrast",
    featurePrefixes: ["sig.slateSymbolicContrast."],
    description: "Same-date symbolic rarity and dominance contrast",
  },
]

export const buildPerfectPrototypeDailySequenceShapeletHypothesisCatalog = () => [
  {
    hypothesisId: "H1",
    name: "price_range_shapelets",
    featurePrefixes: [
      "sig.seqShapelet.price5.",
      "sig.seqShapelet.price10.",
      "sig.seqShapelet.price20.",
      "sig.seqShapelet.range10.",
      "sig.seqShapelet.range20.",
    ],
    description: "Multiscale price and range sequence-shapelet assignments",
  },
  {
    hypothesisId: "H2",
    name: "body_volume_shapelets",
    featurePrefixes: [
      "sig.seqShapelet.body10.",
      "sig.seqShapelet.volume10.",
      "sig.seqShapelet.volume20.",
      "sig.seqShapelet.combo.",
    ],
    description: "Body/volume sponsorship shapelets plus combo assignments",
  },
  {
    hypothesisId: "H3",
    name: "shapelet_plus_slate_contrast",
    featurePrefixes: [
      "sig.seqShapelet.",
      "sig.slateSymbolicContrast.",
    ],
    description: "Sequence-shapelet assignments combined with same-date symbolic contrast",
  },
]

export const buildPerfectPrototypeSupportLikeDetectorHypothesisCatalog = () => [
  {
    hypothesisId: "H1",
    name: "support_like_price_range_shapelets",
    featurePrefixes: [
      "sig.seqShapelet.price5.",
      "sig.seqShapelet.price10.",
      "sig.seqShapelet.price20.",
      "sig.seqShapelet.range10.",
      "sig.seqShapelet.range20.",
    ],
    description: "Support-like detector over multiscale price/range shapelets",
  },
  {
    hypothesisId: "H2",
    name: "support_like_body_volume_shapelets",
    featurePrefixes: [
      "sig.seqShapelet.body10.",
      "sig.seqShapelet.volume10.",
      "sig.seqShapelet.volume20.",
      "sig.seqShapelet.combo.",
    ],
    description: "Support-like detector over body/volume sponsorship shapelets",
  },
  {
    hypothesisId: "H3",
    name: "support_like_shapelet_plus_slate_contrast",
    featurePrefixes: [
      "sig.seqShapelet.",
      "sig.slateSymbolicContrast.",
    ],
    description: "Support-like detector combining shapelets with same-date symbolic contrast",
  },
]

export const selectPerfectPrototypeHypothesisFeatureKeys = ({ featureKeys = [], hypothesis } = {}) => {
  const prefixes = Array.isArray(hypothesis?.featurePrefixes) ? hypothesis.featurePrefixes : []
  return uniqueStrings(
    (Array.isArray(featureKeys) ? featureKeys : []).filter((featureKey) =>
      prefixes.some((prefix) => String(featureKey ?? "").startsWith(prefix)),
    ),
  )
}

export const buildPerfectPrototypeFeatureBankContract = ({
  bankId = "daily_ohlcv_mechanism_bank_v1",
  bankVersion = 1,
  targetUniverseId = "daily_trade_slate_v1",
  hypotheses = buildPerfectPrototypeDailyMechanismHypothesisCatalog(),
} = {}) => {
  const normalized = {
    bankId: String(bankId ?? "").trim() || "daily_ohlcv_mechanism_bank_v1",
    bankVersion: Number(bankVersion ?? 1) || 1,
    targetUniverseId: String(targetUniverseId ?? "").trim() || "daily_trade_slate_v1",
    hypotheses: (Array.isArray(hypotheses) ? hypotheses : []).map((hypothesis) => ({
      hypothesisId: String(hypothesis?.hypothesisId ?? "").trim() || null,
      name: String(hypothesis?.name ?? "").trim() || null,
      featurePrefixes: uniqueStrings(hypothesis?.featurePrefixes ?? []),
    })),
  }
  const contractHash = crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
  return {
    ...normalized,
    contractHash,
  }
}
