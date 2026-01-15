import { useEffect, useRef } from "react"

export const usePolling = (
  task: () => Promise<void> | void,
  intervalMs: number,
  immediate = true,
) => {
  const taskRef = useRef(task)
  useEffect(() => {
    taskRef.current = task
  }, [task])

  useEffect(() => {
    let active = true
    let timer: number | undefined

    const run = async () => {
      if (!active) {
        return
      }
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        timer = window.setTimeout(run, intervalMs)
        return
      }
      await taskRef.current()
      if (!active) {
        return
      }
      timer = window.setTimeout(run, intervalMs)
    }

    if (immediate) {
      run()
    } else {
      timer = window.setTimeout(run, intervalMs)
    }

    return () => {
      active = false
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [intervalMs, immediate, task])
}
