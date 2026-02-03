export const SAFETY_BLOCK_MESSAGE =
  "안전 정책에 위반되는 내용이 포함되어 있습니다."

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  hate_or_slur: [
    /병신/i,
    /좆/i,
    /씨발/i,
    /시발/i,
    /느금마/i,
    /니애미/i,
    /nigger/i,
  ],
  threats: [/죽여/i, /죽인다/i, /살해/i, /폭발/i, /테러/i, /불태워/i],
  doxxing: [
    /주민등록번호/i,
    /주민번호/i,
    /전화번호/i,
    /휴대폰번호/i,
    /계좌번호/i,
    /주소/i,
    /집주소/i,
    /신상/i,
  ],
  targeted_harassment: [/꺼져/i, /꺼지라/i, /찢어/i, /조져/i, /때려/i],
  sexual_insults_real_person: [/강간/i, /성폭행/i, /섹스/i, /창녀/i, /걸레/i],
}

export function detectUnsafeCategory(text: string) {
  const categories = new Set<string>()
  const normalized = text.toLowerCase()

  Object.entries(CATEGORY_PATTERNS).forEach(([category, patterns]) => {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      categories.add(category)
    }
  })

  return {
    ok: categories.size === 0,
    categories: Array.from(categories),
  }
}

export function getSafetyErrorDetails(categories: string[]) {
  return {
    message: SAFETY_BLOCK_MESSAGE,
    details: { categories },
  }
}
