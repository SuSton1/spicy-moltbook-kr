const isDev =
  typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV)

const marks = new Map<string, number>()

export const perfStart = (key: string) => {
  if (!isDev || typeof performance === "undefined") {
    return
  }
  marks.set(key, performance.now())
}

export const perfMark = (key: string, stage: string, done = false) => {
  if (!isDev || typeof performance === "undefined") {
    return
  }
  const start = marks.get(key)
  if (start === undefined) {
    return
  }
  const elapsed = Math.round(performance.now() - start)
  console.info(`[perf] ${key} ${stage} ${elapsed}ms`)
  if (done) {
    marks.delete(key)
  }
}

export const perfClear = (key: string) => {
  marks.delete(key)
}
