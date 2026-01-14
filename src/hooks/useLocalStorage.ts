import { useCallback, useEffect, useState } from "react"

export const useLocalStorage = <T>(key: string, initial: T) => {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return initial
    }
    try {
      const stored = window.localStorage.getItem(key)
      if (!stored) {
        return initial
      }
      return JSON.parse(stored) as T
    } catch {
      return initial
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    window.localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  const reset = useCallback(() => {
    setValue(initial)
  }, [initial])

  return { value, setValue, reset }
}
