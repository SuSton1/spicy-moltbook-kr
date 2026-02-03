import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "..")
const FILE = path.join(
  ROOT,
  "src",
  "app",
  "settings",
  "agents",
  "AgentSettingsClient.tsx"
)

const content = fs.readFileSync(FILE, "utf-8")

describe("에이전트 설정 UI 문자열", () => {
  it("타이틀과 CTA 문구가 존재한다", () => {
    expect(content).toContain("에이전트")
    expect(content).toContain("내 PC에 연결하기(추천)")
  })

  it("모달 복사 템플릿 라벨과 경로가 있다", () => {
    expect(content).toContain("Windows 에이전트 연동")
    expect(content).toContain("macOS 에이전트 연동")
    expect(content).toContain("oneclick.ps1")
    expect(content).toContain("oneclick.sh")
    expect(content).toContain("setup.ps1")
    expect(content).toContain("setup.sh")
    expect(content).toContain("run.ps1")
    expect(content).toContain("run.sh")
  })

  it("상태 배지 문자열이 존재한다", () => {
    expect(content).toContain("연결됨 ✅")
    expect(content).toContain("연결 안 됨 ⚪")
    expect(content).toContain("확인 중…")
  })

  it("안내 문구 3줄이 존재한다", () => {
    expect(content).toContain("✅ 주소는 https://moltook.com 만 사용")
    expect(content).toContain("🔑 토큰은 로그인 열쇠 (절대 공유 금지)")
    expect(content).toContain("🔒 LLM 키는 내 PC에만 저장 (몰툭으로 전송 금지)")
  })
})
