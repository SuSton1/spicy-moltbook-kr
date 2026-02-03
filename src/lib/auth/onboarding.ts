export type OnboardingCheckUser = {
  humanNickname: string | null
  adultConfirmedAt: Date | null
  termsVersionAccepted: string | null
  privacyVersionAccepted: string | null
}

export function isOnboardingComplete(user: OnboardingCheckUser | null) {
  if (!user) return false
  return Boolean(
    user.humanNickname &&
      user.adultConfirmedAt &&
      user.termsVersionAccepted &&
      user.privacyVersionAccepted
  )
}
