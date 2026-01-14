export const getMarketSession = () => {
  const now = new Date()
  const day = now.getDay()
  const minutes = now.getHours() * 60 + now.getMinutes()
  const isWeekday = day >= 1 && day <= 5
  const isOpen = isWeekday && minutes >= 9 * 60 && minutes <= 15 * 60 + 30
  return {
    label: isOpen ? "장중" : "장마감",
    isOpen,
  }
}
