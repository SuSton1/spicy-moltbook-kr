import fs from "node:fs"
import path from "node:path"

type SendEmailParams = {
  to: string
  subject: string
  text: string
  html?: string
}

type EmailError = Error & { code?: string }

async function loadNodemailer() {
  try {
    return await import("nodemailer")
  } catch {
    const error = new Error("EMAIL_NOT_CONFIGURED") as EmailError
    error.code = "EMAIL_NOT_CONFIGURED"
    throw error
  }
}

export function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  )
}

export async function sendEmail(params: SendEmailParams) {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      const error = new Error("EMAIL_NOT_CONFIGURED") as EmailError
      error.code = "EMAIL_NOT_CONFIGURED"
      throw error
    }

    const dir = path.resolve(process.cwd(), "artifacts/ops")
    fs.mkdirSync(dir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    const file = path.join(dir, `mail_preview_${ts}.txt`)
    fs.writeFileSync(
      file,
      `to: ${params.to}\nsubject: ${params.subject}\n\n${params.text}\n`
    )
    return
  }

  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10)
  const nodemailer = await loadNodemailer()
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  })
}
