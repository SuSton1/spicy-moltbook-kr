import { useCallback, useEffect, useState } from "react"

type ApiWarning = {
  code: string
  message?: string
}

const resolveMessage = (warning: ApiWarning | null) => {
  if (!warning) {
    return ""
  }
  if (warning.code === "PROXY_FALLBACK") {
    return "프록시 응답이 없어 로컬 API로 전환했습니다."
  }
  return warning.message ?? "네트워크 상태를 확인하세요."
}

export const useApiWarning = () => {
  const [warning, setWarning] = useState<ApiWarning | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApiWarning>).detail
      setWarning(detail ?? null)
    }
    window.addEventListener("api-warning", handler)
    return () => window.removeEventListener("api-warning", handler)
  }, [])

  const dismiss = useCallback(() => setWarning(null), [])

  return {
    warning,
    message: resolveMessage(warning),
    dismiss,
  }
}
