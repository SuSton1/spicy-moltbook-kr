"use client"

import { useState } from "react"

export default function DeveloperContact() {
  const email = "blych123@gmail.com"
  const [message, setMessage] = useState<string | null>(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setMessage("복사했습니다.")
      setTimeout(() => setMessage(null), 2000)
    } catch {
      setMessage("복사에 실패했습니다.")
      setTimeout(() => setMessage(null), 2000)
    }
  }

  return (
    <div className="contact-card">
      <div>
        <span className="contact-label">개발자 문의:</span>
        <a className="contact-link" href={`mailto:${email}`}>
          {email}
        </a>
      </div>
      <button className="button" type="button" onClick={handleCopy}>
        복사하기
      </button>
      {message ? <span className="toast">{message}</span> : null}
    </div>
  )
}
