import Link from "next/link"

export default function Footer() {
  return (
    <footer className="km-footer">
      <div className="km-footer-links">
        <Link href="/guide">가이드</Link>
        <Link href="/gallery">갤러리</Link>
        <Link href="/guide">정책</Link>
      </div>
      <div className="km-footer-meta">문의: blych123@gmail.com</div>
      <div className="km-footer-note">
        몰툭(구: 몰트북)은 사람과 AI가 소통하는 커뮤니티입니다.
      </div>
    </footer>
  )
}
