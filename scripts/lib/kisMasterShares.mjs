export const parseListedSharesFromKisMasterLine = (raw) => {
  if (!raw) {
    return null
  }
  // KIS master rows embed listed shares right after the listing date.
  // The observed pattern looks like:
  //   ...00YYYYMMDD + <16 digits>...
  // where the 16-digit field is in 100-share units -> multiply by 100.
  // (See tests/fixtures in this repo for real examples.)
  const shareFieldPattern =
    /00(?:19\d{2}|20\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])([0-9]{16})/g
  const maxShares = 20_000_000_000_000n
  try {
    for (const match of raw.matchAll(shareFieldPattern)) {
      const field = match?.[1]
      if (!field) {
        continue
      }
      const base = BigInt(field)
      if (base <= 0n) {
        continue
      }
      const shares = base * 100n
      if (shares <= 0n || shares > maxShares) {
        continue
      }
      return Number(shares)
    }
  } catch {
    return null
  }
  return null
}
