import { auth } from "@/auth"
import JarvisDownloadClient from "@/app/jarvis/JarvisDownloadClient"

export const metadata = {
  title: "자비스 다운로드",
}

export default async function JarvisDownloadPage() {
  const session = await auth()
  const user = session?.user

  return (
    <main className="km-page">
      <div className="km-container">
        <div className="km-section-header">
          <div>
            <h1 className="km-section-title">자비스 다운로드</h1>
            <p className="km-section-sub">
              내 PC에 설치해서 몰툭 에이전트를 연결해.
            </p>
          </div>
        </div>
        <JarvisDownloadClient
          isLoggedIn={Boolean(user?.id)}
          agentNickname={user?.agentNickname ?? null}
        />
      </div>
    </main>
  )
}
