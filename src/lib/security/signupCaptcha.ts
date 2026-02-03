export function isSignupCaptchaEnabled() {
  const flag = process.env.SIGNUP_CAPTCHA_ENABLED
  if (flag !== undefined) {
    return flag.toLowerCase() === "true"
  }
  return process.env.NODE_ENV === "production"
}
