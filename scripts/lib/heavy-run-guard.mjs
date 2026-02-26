import process from "node:process"

const isWsl = () =>
  Boolean(
    process.env.WSL_DISTRO_NAME ||
    process.env.WSL_INTEROP ||
    process.env.WSLENV,
  )

const isLocalWorkspace = () => process.cwd().startsWith("/home/saida/")

export const assertServerOnly = ({
  allowEnv = "STOCKDESK_ALLOW_LOCAL_HEAVY",
  script = "heavy-script",
} = {}) => {
  if (String(process.env[allowEnv] ?? "").trim() === "1") {
    return
  }

  if (isWsl() || isLocalWorkspace()) {
    const message =
      `[guard] Refusing to run ${script} in local/WSL environment.\n` +
      `Run it on the server only: spicy-moltbook:/home/moltook/apps/stockdesk\n` +
      `(Override: set ${allowEnv}=1 explicitly)`
    const error = new Error(message)
    error.code = "LOCAL_HEAVY_GUARD"
    throw error
  }
}
