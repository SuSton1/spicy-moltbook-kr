import { summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

const FAMILY_PREFIXES = [
  "sig.microCard.dayGlyph.",
  "sig.phaseGrammar.transition.",
  "sig.microCard.kgram.",
  "sig.sponsorCoupling.pattern.",
  "sig.anchorPath.extrema.",
  "sig.slateSymbolicContrast.",
]

const rowTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => String(token).startsWith("sig.")))

const pickFirstMatching = (tokens = [], prefix) =>
  (tokens ?? []).find((token) => String(token ?? "").startsWith(prefix)) ?? null

const buildRowSignature = (row) => {
  const tokens = rowTokens(row)
  return uniqueStrings(
    FAMILY_PREFIXES.map((prefix) => pickFirstMatching(tokens, prefix)).filter(Boolean),
  ).join("|")
}

export const buildPerfectPrototypeDailySymbolicMicrocardRouter = ({
  family,
  minCardDateCount = 4,
  maxCardCount = 5,
  maxCardShare = 0.8,
} = {}) => {
  const grouped = new Map()
  for (const row of family?.witnessRows ?? []) {
    const signature = buildRowSignature(row)
    if (!signature) continue
    const bucket = grouped.get(signature) ?? []
    bucket.push(row)
    grouped.set(signature, bucket)
  }
  const cards = Array.from(grouped.entries())
    .map(([signature, rows], index) => ({
      microCardId: `MC${index + 1}`,
      signature,
      witnessRows: rows,
      seedTokens: uniqueStrings(signature.split("|").filter(Boolean)),
      dateKeys: uniqueStrings(rows.map((row) => row?.dateKey).filter(Boolean)),
    }))
    .filter((card) => card.dateKeys.length >= Math.max(1, Math.floor(Number(minCardDateCount) || 4)))
    .sort((left, right) => right.dateKeys.length - left.dateKeys.length || left.signature.localeCompare(right.signature))
    .slice(0, Math.max(1, Math.floor(Number(maxCardCount) || 5)))
    .map((card, index) => ({
      ...card,
      microCardId: `MC${index + 1}`,
    }))

  const totalWitnessDates = new Set((family?.witnessRows ?? []).map((row) => row?.dateKey).filter(Boolean)).size
  const maxObservedCardShare =
    totalWitnessDates > 0 ? Math.max(...cards.map((card) => card.dateKeys.length / totalWitnessDates), 0) : 0
  const distinctDateSignatures = new Set(cards.map((card) => card.dateKeys.join(",")))
  const ok = cards.length >= 2 && distinctDateSignatures.size >= 2 && maxObservedCardShare <= Number(maxCardShare)
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_symbolic_microcard_router",
    microCards: cards,
    summary: {
      ...(family?.summary ?? {}),
      symbolicMicrocardReady: ok,
      microCardCount: cards.length,
      microCardDistinctDateSignatureCount: distinctDateSignatures.size,
      maxMicroCardShare: maxObservedCardShare,
      microCardPreview: cards.map((card) => ({
        microCardId: card.microCardId,
        signature: card.signature,
        dateCount: card.dateKeys.length,
        seedTokens: card.seedTokens,
      })),
      microCardWitnessSummary: summarizeRows((family?.witnessRows ?? []).filter((row) =>
        cards.some((card) => card.dateKeys.includes(String(row?.dateKey ?? "").trim())),
      )),
    },
  }
}
