import { runCli } from "./cli"

runCli(process.argv.slice(2)).catch((error) => {
  console.error("실행 실패:", error instanceof Error ? error.message : error)
  process.exit(1)
})
