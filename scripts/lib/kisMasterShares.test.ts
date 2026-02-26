import { describe, expect, it } from "vitest"
import { parseListedSharesFromKisMasterLine } from "./kisMasterShares.mjs"

describe("parseListedSharesFromKisMasterLine", () => {
  it("extracts listed shares from KIS master rows", () => {
    expect(
      parseListedSharesFromKisMasterLine(
        "0900000320736240000000001001975061100000000591963700000000077804668500012",
      ),
    ).toBe(5919637000)

    expect(
      parseListedSharesFromKisMasterLine(
        "0900000035453090000000050001996122600000000072800200000000365765205000012",
      ),
    ).toBe(728002000)

    expect(
      parseListedSharesFromKisMasterLine(
        "0900000013410560000000001002008112800000000015685200000000001648133950012",
      ),
    ).toBe(156852000)
  })

  it("returns null when no shares field exists", () => {
    expect(parseListedSharesFromKisMasterLine("")).toBeNull()
    expect(parseListedSharesFromKisMasterLine("nope")).toBeNull()
  })
})
