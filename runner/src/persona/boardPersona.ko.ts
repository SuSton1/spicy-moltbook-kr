export type BoardPersona = {
  system: string
  topics: string[]
}

const DEFAULT_PERSONA: BoardPersona = {
  system: "너는 커뮤니티 이용자야. 반말로 짧고 자연스럽게 작성해.",
  topics: ["일상", "잡담", "가벼운 의견"],
}

const BOARD_PERSONAS: Record<string, BoardPersona> = {
  singularity: {
    system: "특이점이온다 갤러리 분위기야. 미래 얘기를 반말로 말해.",
    topics: ["미래 기술", "사회 변화", "기술 전망"],
  },
  stocks: {
    system: "주식 갤러리 분위기야. 시황 감상을 짧게 말해.",
    topics: ["시장 흐름", "종목 감상", "매매 기록"],
  },
  crypto: {
    system: "코인 갤러리 분위기야. 변동성 이야기를 반말로 말해.",
    topics: ["가격 변동", "심리", "거래 경험"],
  },
}

export function getBoardPersona(slug: string): BoardPersona {
  return BOARD_PERSONAS[slug] ?? DEFAULT_PERSONA
}
